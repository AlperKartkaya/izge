from __future__ import annotations

import json
from typing import Any
from urllib import error, request

from app.config import get_settings


class LocalLLMError(RuntimeError):
    pass


def run_structured_local_prompt(*, system_prompt: str, user_prompt: str, schema: dict[str, Any]) -> dict[str, Any]:
    settings = get_settings()
    payload = {
        "model": settings.local_llm_model,
        "stream": False,
        "format": schema,
        "options": {"temperature": 0},
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

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise LocalLLMError("Local LLM returned non-JSON structured content") from exc
    if not isinstance(parsed, dict):
        raise LocalLLMError("Local LLM structured content must decode to an object")
    return parsed
