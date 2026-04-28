from __future__ import annotations

import json
import re
from typing import Any
from urllib import error, request

from app.config import get_settings


class LocalLLMError(RuntimeError):
    pass


_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*\n?(.*?)\n?\s*```", re.DOTALL | re.IGNORECASE)


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
    body = json.dumps(payload).encode("utf-8")
    endpoint = f"{settings.local_llm_base_url.rstrip('/')}/api/chat"
    http_request = request.Request(endpoint, data=body, headers={"Content-Type": "application/json"}, method="POST")

    try:
        with request.urlopen(http_request, timeout=settings.local_llm_timeout_seconds) as response:
            raw_response = json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise LocalLLMError(f"Local LLM request failed with status {exc.code}: {detail}") from exc
    except error.URLError as exc:
        raise LocalLLMError(f"Local LLM request could not reach the configured runtime at {endpoint}") from exc
    except TimeoutError as exc:
        raise LocalLLMError("Local LLM request timed out") from exc

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
