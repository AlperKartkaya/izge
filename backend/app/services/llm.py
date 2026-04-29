from __future__ import annotations

import http.client
import ipaddress
import json
import re
from typing import Any
from urllib import parse

from app.config import get_settings


class LocalLLMError(RuntimeError):
    pass


_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*\n?(.*?)\n?\s*```", re.DOTALL | re.IGNORECASE)


def validated_local_llm_base_url() -> str:
    settings = get_settings()
    raw_url = settings.local_llm_base_url.strip()
    parsed = parse.urlparse(raw_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise LocalLLMError("Local LLM base URL must use http(s) and include a hostname")
    if parsed.username or parsed.password:
        raise LocalLLMError("Local LLM base URL must not include credentials")

    hostname = parsed.hostname.strip().lower()
    if hostname in {"localhost", "ollama"}:
        return raw_url.rstrip("/")

    try:
        ip_address = ipaddress.ip_address(hostname)
    except ValueError:
        if settings.allow_public_llm_base_url:
            return raw_url.rstrip("/")
        if "." not in hostname or hostname.endswith((".local", ".internal", ".lan")):
            return raw_url.rstrip("/")
        raise LocalLLMError(
            "Local LLM base URL must be loopback/private/internal unless IZGE_ALLOW_PUBLIC_LLM_BASE_URL=true"
        )

    if ip_address.is_link_local or ip_address.is_multicast or ip_address.is_unspecified or ip_address.is_reserved:
        raise LocalLLMError("Local LLM base URL points to a disallowed network address")
    if ip_address.is_loopback or ip_address.is_private:
        return raw_url.rstrip("/")
    if not settings.allow_public_llm_base_url:
        raise LocalLLMError(
            "Local LLM base URL must be loopback/private/internal unless IZGE_ALLOW_PUBLIC_LLM_BASE_URL=true"
        )
    return raw_url.rstrip("/")


def request_local_llm_json(
    path: str,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    timeout_seconds: float | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    base_url = validated_local_llm_base_url()
    target_url = parse.urljoin(f"{base_url}/", path.lstrip("/"))
    parsed = parse.urlparse(target_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise LocalLLMError("Validated Local LLM URL became invalid before request")

    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    request_path = parsed.path or "/"
    if parsed.query:
        request_path = f"{request_path}?{parsed.query}"

    connection_class = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    connection = connection_class(
        parsed.hostname,
        parsed.port,
        timeout=timeout_seconds if timeout_seconds is not None else settings.local_llm_timeout_seconds,
    )
    try:
        connection.request(method.upper(), request_path, body=body, headers=headers)
        response = connection.getresponse()
        raw_body = response.read().decode("utf-8", errors="ignore")
    except TimeoutError as exc:
        raise LocalLLMError("Local LLM request timed out") from exc
    except OSError as exc:
        raise LocalLLMError(f"Local LLM request could not reach the configured runtime at {base_url}") from exc
    finally:
        connection.close()

    if response.status >= 400:
        raise LocalLLMError(f"Local LLM request failed with status {response.status}: {raw_body}")
    try:
        decoded = json.loads(raw_body)
    except json.JSONDecodeError as exc:
        raise LocalLLMError("Local LLM returned a non-JSON gateway response") from exc
    if not isinstance(decoded, dict):
        raise LocalLLMError("Local LLM gateway response must decode to an object")
    return decoded


def _extract_balanced_json_object(value: str) -> str | None:
    start = value.find("{")
    if start == -1:
        return None

    depth = 0
    in_string = False
    escaped = False
    for index, character in enumerate(value[start:], start=start):
        if in_string:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                in_string = False
            continue
        if character == '"':
            in_string = True
        elif character == "{":
            depth += 1
        elif character == "}":
            depth -= 1
            if depth == 0:
                return value[start : index + 1].strip()
    return None


def _extract_json_content(raw: str) -> str:
    """Try to extract clean JSON from potentially wrapped LLM output."""
    stripped = raw.strip()
    match = _JSON_FENCE_RE.search(stripped)
    if match:
        return match.group(1).strip()
    return _extract_balanced_json_object(stripped) or stripped


def run_structured_local_prompt(*, system_prompt: str, user_prompt: str, schema: dict[str, Any]) -> dict[str, Any]:
    settings = get_settings()
    payload = {
        "model": settings.local_llm_model,
        "stream": False,
        "format": schema,
        "options": {"temperature": 0},
        "think": False,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    raw_response = request_local_llm_json("/api/chat", method="POST", payload=payload)

    message = raw_response.get("message")
    if not isinstance(message, dict):
        raise LocalLLMError("Local LLM response did not include a message object")
    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise LocalLLMError("Local LLM response did not include structured content")

    json_text = _extract_json_content(content)
    try:
        parsed = json.loads(json_text)
    except json.JSONDecodeError as exc:
        raise LocalLLMError(f"Local LLM returned non-JSON structured content: {content[:300]}") from exc
    if not isinstance(parsed, dict):
        raise LocalLLMError("Local LLM structured content must decode to an object")
    return parsed
