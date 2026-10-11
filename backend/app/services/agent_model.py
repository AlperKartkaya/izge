from __future__ import annotations

import http.client
import hashlib
import ipaddress
import json
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Iterator, Protocol
from urllib import parse

from app.config import get_settings
from app.services.llm import LocalLLMError


class AgentModelError(LocalLLMError):
    pass


_PROFILES = {"ollama", "onprem", "glm", "deepseek", "codex"}
_EFFORTS = {"none", "low", "medium", "high", "xhigh", "max"}
_DEFAULT_EFFORTS = {"ollama": "none", "onprem": "none", "glm": "low", "deepseek": "none", "codex": "medium"}
_CODEX_TOKEN_FLOORS = {"none": 1024, "low": 2048, "medium": 4096, "high": 6144, "xhigh": 8192, "max": 8192}
_CODEX_MAX_OUTPUT_TOKENS = 8192
_session_profile: ContextVar[str | None] = ContextVar("agent_model_profile", default=None)
_session_effort: ContextVar[str | None] = ContextVar("agent_model_effort", default=None)


class _ReadableStream(Protocol):
    def readline(self, limit: int = -1, /) -> bytes: ...


class _CodexIncompleteError(AgentModelError):
    def __init__(self, reason: str | None) -> None:
        self.reason = reason
        super().__init__("Codex response was incomplete")


def profile_supports_native_web_search(profile: str) -> bool:
    return profile == "codex"


def native_web_search_available(profile: str | None = None) -> bool:
    settings = get_settings()
    selected_profile = profile or _session_profile.get() or settings.agent_model_provider
    return (
        profile_supports_native_web_search(selected_profile)
        and bool((settings.agent_codex_bridge_base_url or "").strip())
        and _secret_text(settings.agent_codex_bridge_token) is not None
    )


@contextmanager
def model_session(profile: str | None = None, effort: str | None = None) -> Iterator[None]:
    if profile is not None and profile not in _PROFILES:
        raise AgentModelError(f"Unsupported agent model profile: {profile}")
    if effort is not None and effort not in _EFFORTS:
        raise AgentModelError(f"Unsupported reasoning effort: {effort}")
    profile_token = _session_profile.set(profile)
    effort_token = _session_effort.set(effort)
    try:
        yield
    finally:
        _session_profile.reset(profile_token)
        _session_effort.reset(effort_token)


def model_catalog() -> dict[str, Any]:
    settings = get_settings()
    glm_enabled = _secret_text(settings.agent_glm_api_key) is not None
    deepseek_enabled = _secret_text(settings.agent_deepseek_api_key) is not None
    codex_enabled = bool((settings.agent_codex_bridge_base_url or "").strip()) and _secret_text(
        settings.agent_codex_bridge_token
    ) is not None
    profiles = [
        {
            "id": "ollama",
            "label": f"Ollama · {settings.local_llm_model}",
            "model": settings.local_llm_model,
            "enabled": settings.local_llm_enabled,
            "reason": None if settings.local_llm_enabled else "Yerel model kapalı.",
            "data_boundary": "local",
            "supported_efforts": ["none"],
            "default_effort": "none",
            "native_web_search": False,
        },
        {
            "id": "onprem",
            "label": f"Şirket modeli · {settings.agent_onprem_model or 'yapılandırılmadı'}",
            "model": settings.agent_onprem_model,
            "enabled": bool(settings.agent_onprem_base_url and settings.agent_onprem_model),
            "reason": None
            if settings.agent_onprem_base_url and settings.agent_onprem_model
            else "Şirket model sunucusu yapılandırılmadı.",
            "data_boundary": "local",
            "supported_efforts": ["none", "low", "medium", "high", "xhigh", "max"],
            "default_effort": "none",
            "native_web_search": False,
        },
        {
            "id": "glm",
            "label": "GLM 5.3 Flash",
            "model": "glm-5.3-flash",
            "enabled": glm_enabled,
            "reason": None if glm_enabled else "GLM API anahtarı eksik.",
            "data_boundary": "cloud",
            "supported_efforts": ["low", "high", "max"],
            "default_effort": "low",
            "native_web_search": False,
        },
        {
            "id": "deepseek",
            "label": "DeepSeek V4.1 Flash",
            "model": "deepseek-flash",
            "enabled": deepseek_enabled,
            "reason": None if deepseek_enabled else "DeepSeek API anahtarı eksik.",
            "data_boundary": "cloud",
            "supported_efforts": ["none", "low", "high", "max"],
            "default_effort": "none",
            "native_web_search": False,
        },
        {
            "id": "codex",
            "label": "GPT-6 Luna · Codex oturumu",
            "model": "gpt-6-luna",
            "enabled": codex_enabled,
            "reason": None if codex_enabled else "Yerel Codex köprüsü adresi veya tokenı eksik.",
            "data_boundary": "cloud",
            "supported_efforts": ["none", "low", "medium", "high", "xhigh", "max"],
            "default_effort": "medium",
            "native_web_search": codex_enabled,
        },
    ]
    return {"default_profile": settings.agent_model_provider, "profiles": profiles}


def resolve_effective_model_options(profile: str | None = None, effort: str | None = None) -> dict[str, str]:
    settings = get_settings()
    selected_profile = profile or settings.agent_model_provider
    if selected_profile not in _PROFILES:
        raise AgentModelError(f"Unsupported agent model profile: {selected_profile}")
    supported = next(
        item["supported_efforts"] for item in model_catalog()["profiles"] if item["id"] == selected_profile
    )
    if effort is not None:
        selected_effort = effort
    elif profile is not None and profile != settings.agent_model_provider:
        selected_effort = _DEFAULT_EFFORTS[selected_profile]
    else:
        selected_effort = settings.agent_model_effort
        if selected_effort not in supported:
            selected_effort = _DEFAULT_EFFORTS[selected_profile]
    if selected_effort not in supported:
        raise AgentModelError(
            f"Reasoning effort '{selected_effort}' is not supported by profile '{selected_profile}'"
        )
    return {"model_profile": selected_profile, "reasoning_effort": selected_effort}


def stream_agent_text(
    messages: list[dict[str, Any]],
    *,
    max_tokens: int,
    schema: dict[str, Any] | None = None,
    timeout_seconds: int | None = None,
) -> Iterator[str]:
    if max_tokens <= 0:
        raise AgentModelError("max_tokens must be positive")
    _validate_messages(messages)
    profile, effort = _selected_session()
    settings = get_settings()
    timeout = timeout_seconds or settings.local_llm_timeout_seconds
    if timeout <= 0:
        raise AgentModelError("timeout_seconds must be positive")

    if profile == "ollama":
        if not settings.local_llm_enabled:
            raise AgentModelError("Ollama profile is disabled")
        payload: dict[str, Any] = {
            "model": settings.local_llm_model,
            "stream": True,
            "options": {"temperature": 0, "num_predict": max_tokens, "num_ctx": 8192},
            "think": False,
            "messages": messages,
        }
        if schema is not None:
            payload["format"] = schema
            payload["messages"] = _messages_with_schema(messages, schema)
        yield from _stream_ollama(
            settings.local_llm_base_url,
            payload,
            timeout,
            allow_public=settings.allow_public_llm_base_url,
        )
        return

    if profile == "codex":
        bridge_url = (settings.agent_codex_bridge_base_url or "").strip()
        if not bridge_url or _secret_text(settings.agent_codex_bridge_token) is None:
            raise AgentModelError("Codex bridge URL and token must be configured")
        codex_messages = _messages_with_schema(messages, schema) if schema is not None else messages
        system, inputs = _responses_input(codex_messages)
        output_tokens = min(_CODEX_MAX_OUTPUT_TOKENS, max(max_tokens, _CODEX_TOKEN_FLOORS[effort]))
        payload: dict[str, Any] = {
            "model": "gpt-6-luna",
            "input": inputs,
            "instructions": system or "You are a helpful assistant.",
            "store": False,
            "stream": True,
            "max_output_tokens": output_tokens,
        }
        payload["reasoning"] = {"effort": effort}
        if schema is not None:
            payload["text"] = {"format": {"type": "json_object"}}
        headers = _bearer_headers(settings.agent_codex_bridge_token)
        while True:
            chunks: list[str] = []
            emitted = False
            try:
                for chunk in _stream_responses(bridge_url, dict(payload), headers, timeout):
                    if schema is not None:
                        chunks.append(chunk)
                    else:
                        emitted = True
                        yield chunk
            except _CodexIncompleteError as exc:
                if emitted or exc.reason != "max_output_tokens" or output_tokens >= _CODEX_MAX_OUTPUT_TOKENS:
                    raise AgentModelError("Codex response was incomplete") from exc
                output_tokens = min(_CODEX_MAX_OUTPUT_TOKENS, output_tokens * 2)
                payload["max_output_tokens"] = output_tokens
                continue
            yield from chunks
            return

    base_url, model, secret = _chat_profile(profile)
    chat_payload: dict[str, Any] = {
        "model": model,
        "messages": _messages_with_schema(messages, schema) if schema is not None else messages,
        "stream": True,
        "max_tokens": max_tokens,
    }
    if effort != "none" or profile == "deepseek":
        chat_payload["reasoning_effort"] = effort
    if schema is not None:
        chat_payload["response_format"] = {"type": "json_object"}
    if profile == "glm":
        chat_payload["tool_stream"] = True
    yield from _stream_chat_completions(base_url, chat_payload, _bearer_headers(secret), timeout)


def structured_agent_output(
    system_prompt: str,
    user_prompt: str,
    schema: dict[str, Any],
    max_tokens: int,
    timeout_seconds: int | None = None,
) -> dict[str, Any]:
    content = "".join(
        stream_agent_text(
            [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
            max_tokens=max_tokens,
            schema=schema,
            timeout_seconds=timeout_seconds,
        )
    )
    try:
        value = json.loads(_extract_json(content))
    except json.JSONDecodeError as exc:
        raise AgentModelError("Agent model returned invalid structured JSON") from exc
    _validate_schema_value(value, schema)
    if not isinstance(value, dict):
        raise AgentModelError("Agent model structured output must be an object")
    return value


def run_native_web_search(query: str) -> list[dict[str, Any]]:
    query = " ".join(query.split())
    if not query or len(query) > 500:
        raise AgentModelError("Web search query must be between 1 and 500 characters")
    profile, effort = _selected_session()
    if profile != "codex" or not native_web_search_available(profile):
        raise AgentModelError("Selected model does not provide native web search")
    settings = get_settings()
    payload = {
        "model": "gpt-6-luna",
        "input": [{"role": "user", "content": query}],
        "instructions": (
            "You must search the public web for the user's query. Return a concise factual summary and cite every "
            "web-derived claim. Do not use or request company data."
        ),
        "store": False,
        "stream": True,
        "max_output_tokens": max(4096, _CODEX_TOKEN_FLOORS[effort]),
        "reasoning": {"effort": effort},
        "tools": [{"type": "web_search", "external_web_access": True}],
    }
    bridge_url = (settings.agent_codex_bridge_base_url or "").strip()
    connection, response = _open_request(
        _validated_private_url(bridge_url),
        "/responses",
        payload,
        _bearer_headers(settings.agent_codex_bridge_token),
        settings.local_llm_timeout_seconds,
    )
    completed = False
    web_search_called = False
    text_parts: list[str] = []
    annotations: list[dict[str, Any]] = []
    try:
        try:
            for data in _sse_data(response):
                try:
                    event = json.loads(data)
                except json.JSONDecodeError as exc:
                    raise AgentModelError("Codex bridge returned an invalid web search event") from exc
                event_type = event.get("type")
                item = event.get("item") if isinstance(event.get("item"), dict) else {}
                if event_type == "response.output_item.added" and item.get("type") == "web_search_call":
                    web_search_called = True
                elif event_type == "response.web_search_call.completed":
                    web_search_called = True
                elif event_type == "response.output_text.delta" and isinstance(event.get("delta"), str):
                    text_parts.append(event["delta"])
                elif event_type == "response.output_text.annotation.added" and isinstance(event.get("annotation"), dict):
                    annotations.append(event["annotation"])
                elif event_type == "response.completed":
                    completed = True
                    response_data = event.get("response") if isinstance(event.get("response"), dict) else {}
                    for output_item in response_data.get("output", []):
                        if not isinstance(output_item, dict):
                            continue
                        if output_item.get("type") == "web_search_call":
                            web_search_called = True
                        for content in output_item.get("content", []):
                            if not isinstance(content, dict) or content.get("type") != "output_text":
                                continue
                            if not text_parts and isinstance(content.get("text"), str):
                                text_parts.append(content["text"])
                            if isinstance(content.get("annotations"), list):
                                annotations.extend(item for item in content["annotations"] if isinstance(item, dict))
                    break
                elif event_type == "response.incomplete":
                    raise AgentModelError("Codex web search response was incomplete")
                elif event_type in {"error", "response.failed"}:
                    raise AgentModelError("Codex bridge reported a web search error")
        except (OSError, TimeoutError) as exc:
            raise AgentModelError("Codex web search stream was interrupted") from exc
    finally:
        connection.close()
    if not completed:
        raise AgentModelError("Codex web search stream ended before completion")
    if not web_search_called:
        raise AgentModelError("Codex did not execute the required web search")

    from app.services.agent_tools import _is_public_url

    answer = "".join(text_parts)
    sources: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    for annotation in annotations:
        url = annotation.get("url")
        if annotation.get("type") != "url_citation" or not isinstance(url, str) or url in seen_urls:
            continue
        if not _is_public_url(url, resolve_dns=False):
            continue
        start = annotation.get("start_index")
        end = annotation.get("end_index")
        # Citations often cover only their marker; keep the associated claim, not just the marker.
        quote = answer[max(0, start - 800):min(len(answer), end + 200)].strip() if isinstance(start, int) and isinstance(end, int) and 0 <= start < end <= len(answer) else answer.strip()
        raw_title = annotation.get("title")
        title = raw_title if isinstance(raw_title, str) else url
        digest = hashlib.sha256(f"{query}\0{url}".encode()).hexdigest()[:24]
        sources.append({
            "artifact_id": f"web:{digest}",
            "title": " ".join(title.split())[:300] or url,
            "quote": " ".join(quote.split())[:2000],
            "source_type": "web",
            "url": url,
        })
        seen_urls.add(url)
        if len(sources) == 5:
            break
    return sources


def _selected_session() -> tuple[str, str]:
    requested_profile = _session_profile.get()
    requested_effort = _session_effort.get()
    options = resolve_effective_model_options(requested_profile, requested_effort)
    return options["model_profile"], options["reasoning_effort"]


def _chat_profile(profile: str) -> tuple[str, str, Any]:
    settings = get_settings()
    if profile == "onprem":
        if not settings.agent_onprem_base_url or not settings.agent_onprem_model:
            raise AgentModelError("On-premise profile is not configured")
        return (
            _validated_private_url(settings.agent_onprem_base_url, settings.agent_allow_public_onprem_url),
            settings.agent_onprem_model,
            settings.agent_onprem_api_key,
        )
    if profile == "glm":
        if _secret_text(settings.agent_glm_api_key) is None:
            raise AgentModelError("GLM API key is not configured")
        return "https://api.z.ai/api/paas/v4", "glm-5.3-flash", settings.agent_glm_api_key
    if profile == "deepseek":
        if _secret_text(settings.agent_deepseek_api_key) is None:
            raise AgentModelError("DeepSeek API key is not configured")
        return "https://api.deepseek.com", "deepseek-flash", settings.agent_deepseek_api_key
    raise AgentModelError(f"Unsupported chat profile: {profile}")


def _validated_private_url(raw_url: str, allow_public: bool = False) -> str:
    parsed = parse.urlparse(raw_url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise AgentModelError("Model base URL must use http(s), include a host, and contain no credentials")
    hostname = parsed.hostname.lower()
    if (
        hostname in {"localhost", "ollama", "host.docker.internal"}
        or "." not in hostname
        or hostname.endswith((".local", ".internal", ".lan"))
    ):
        return raw_url.rstrip("/")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        if allow_public:
            return raw_url.rstrip("/")
        raise AgentModelError("On-premise model URL must be private/internal unless explicitly allowed") from None
    if address.is_link_local or address.is_multicast or address.is_unspecified or address.is_reserved:
        raise AgentModelError("On-premise model URL points to a disallowed network address")
    if address.is_loopback or address.is_private:
        return raw_url.rstrip("/")
    if not allow_public:
        raise AgentModelError("On-premise model URL must be private/internal unless explicitly allowed")
    return raw_url.rstrip("/")


def _bearer_headers(secret: Any) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    value = _secret_text(secret)
    if value is not None:
        headers["Authorization"] = f"Bearer {value}"
    return headers


def _secret_text(secret: Any) -> str | None:
    if secret is None:
        return None
    value = secret.get_secret_value().strip()
    return value or None


def _open_request(base_url: str, path: str, payload: dict[str, Any], headers: dict[str, str], timeout: int):
    target = parse.urlparse(f"{base_url.rstrip('/')}/{path.lstrip('/')}")
    if not target.hostname:
        raise AgentModelError("Agent model service URL has no host")
    connection_type = http.client.HTTPSConnection if target.scheme == "https" else http.client.HTTPConnection
    connection = connection_type(target.hostname, target.port, timeout=timeout)
    try:
        connection.request("POST", target.path or "/", body=json.dumps(payload).encode(), headers=headers)
        response = connection.getresponse()
    except (OSError, TimeoutError) as exc:
        connection.close()
        raise AgentModelError("Agent model service could not be reached") from exc
    if response.status >= 400:
        response.read()
        connection.close()
        raise AgentModelError(f"Agent model service returned HTTP {response.status}")
    return connection, response


def _stream_ollama(
    base_url: str,
    payload: dict[str, Any],
    timeout: int,
    *,
    allow_public: bool = False,
) -> Iterator[str]:
    base_url = _validated_private_url(base_url, allow_public)
    connection, response = _open_request(base_url, "/api/chat", payload, {"Content-Type": "application/json"}, timeout)
    completed = False
    try:
        try:
            while line := response.readline():
                try:
                    event = json.loads(line)
                except json.JSONDecodeError as exc:
                    raise AgentModelError("Ollama returned an invalid stream event") from exc
                if event.get("error"):
                    raise AgentModelError("Ollama reported a generation error")
                message = event.get("message")
                if isinstance(message, dict) and isinstance(message.get("content"), str):
                    yield message["content"]
                if event.get("done") is True:
                    completed = True
                    break
        except (OSError, TimeoutError) as exc:
            raise AgentModelError("Ollama stream was interrupted") from exc
    finally:
        connection.close()
    if not completed:
        raise AgentModelError("Ollama stream ended before completion")


def _stream_chat_completions(
    base_url: str, payload: dict[str, Any], headers: dict[str, str], timeout: int
) -> Iterator[str]:
    connection, response = _open_request(base_url, "/chat/completions", payload, headers, timeout)
    completed = False
    try:
        try:
            for data in _sse_data(response):
                if data == "[DONE]":
                    completed = True
                    break
                try:
                    event = json.loads(data)
                    choices = event.get("choices") or []
                    delta = choices[0].get("delta", {}) if choices else {}
                except (json.JSONDecodeError, AttributeError, IndexError) as exc:
                    raise AgentModelError("Agent model returned an invalid stream event") from exc
                content = delta.get("content")
                if isinstance(content, str):
                    yield content
        except (OSError, TimeoutError) as exc:
            raise AgentModelError("Agent model stream was interrupted") from exc
    finally:
        connection.close()
    if not completed:
        raise AgentModelError("Agent model stream ended before completion")


def _stream_responses(
    base_url: str, payload: dict[str, Any], headers: dict[str, str], timeout: int
) -> Iterator[str]:
    base_url = _validated_private_url(base_url)
    connection, response = _open_request(base_url, "/responses", payload, headers, timeout)
    completed = False
    try:
        try:
            for data in _sse_data(response):
                try:
                    event = json.loads(data)
                except json.JSONDecodeError as exc:
                    raise AgentModelError("Codex bridge returned an invalid stream event") from exc
                if event.get("type") == "response.output_text.delta" and isinstance(event.get("delta"), str):
                    yield event["delta"]
                elif event.get("type") == "response.completed":
                    completed = True
                    break
                elif event.get("type") == "response.incomplete":
                    response_data = event.get("response") if isinstance(event.get("response"), dict) else {}
                    details = response_data.get("incomplete_details")
                    reason = details.get("reason") if isinstance(details, dict) and isinstance(details.get("reason"), str) else None
                    raise _CodexIncompleteError(reason)
                elif event.get("type") in {"error", "response.failed"}:
                    raise AgentModelError("Codex bridge reported a generation error")
        except (OSError, TimeoutError) as exc:
            raise AgentModelError("Codex bridge stream was interrupted") from exc
    finally:
        connection.close()
    if not completed:
        raise AgentModelError("Codex stream ended before completion")


def _sse_data(response: _ReadableStream) -> Iterator[str]:
    data_lines: list[str] = []
    while line := response.readline():
        text = line.decode("utf-8", errors="replace").rstrip("\r\n")
        if not text:
            if data_lines:
                yield "\n".join(data_lines)
                data_lines = []
            continue
        if text.startswith("data:"):
            data_lines.append(text[5:].lstrip())
    if data_lines:
        yield "\n".join(data_lines)


def _validate_messages(messages: list[dict[str, Any]]) -> None:
    if not messages:
        raise AgentModelError("At least one model message is required")
    for message in messages:
        if message.get("role") not in {"system", "user", "assistant"} or not isinstance(message.get("content"), str):
            raise AgentModelError("Model messages require a supported role and string content")


def _messages_with_schema(messages: list[dict[str, Any]], schema: dict[str, Any]) -> list[dict[str, Any]]:
    return [dict(message) for message in messages] + [
        {
            "role": "user",
            "content": "Return one JSON object only. It must validate against this schema:\n"
            + json.dumps(schema, sort_keys=True),
        },
    ]


def _responses_input(messages: list[dict[str, Any]]) -> tuple[str, list[dict[str, str]]]:
    systems = [message["content"] for message in messages if message["role"] == "system"]
    inputs = [message for message in messages if message["role"] != "system"]
    return "\n\n".join(systems), inputs


def _extract_json(content: str) -> str:
    stripped = content.strip()
    if stripped.startswith("```") and stripped.endswith("```"):
        stripped = stripped.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    start, end = stripped.find("{"), stripped.rfind("}")
    return stripped[start : end + 1] if start >= 0 and end >= start else stripped


def _validate_schema_value(value: Any, schema: dict[str, Any], path: str = "output") -> None:
    expected = schema.get("type")
    type_map = {"object": dict, "array": list, "string": str, "integer": int, "number": (int, float), "boolean": bool}
    if expected in type_map and (not isinstance(value, type_map[expected]) or expected in {"integer", "number"} and isinstance(value, bool)):
        raise AgentModelError(f"Structured {path} does not match schema type '{expected}'")
    if "enum" in schema and value not in schema["enum"]:
        raise AgentModelError(f"Structured {path} is not an allowed value")
    if expected == "object":
        for key in schema.get("required", []):
            if key not in value:
                raise AgentModelError(f"Structured {path} is missing required field '{key}'")
        properties = schema.get("properties", {})
        for key, child in properties.items():
            if key in value and isinstance(child, dict):
                _validate_schema_value(value[key], child, f"{path}.{key}")
    if expected == "array" and isinstance(schema.get("items"), dict):
        for index, item in enumerate(value):
            _validate_schema_value(item, schema["items"], f"{path}[{index}]")
