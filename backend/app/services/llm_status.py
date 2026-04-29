from __future__ import annotations

import json
import time
from datetime import UTC, datetime
from typing import Any
from urllib import error, request

from app.config import get_settings
from app.services.llm import LocalLLMError, run_structured_local_prompt


def _gateway_url(path: str) -> str:
    settings = get_settings()
    return f"{settings.local_llm_base_url.rstrip('/')}{path}"


def _request_json(path: str, *, timeout_seconds: float) -> dict[str, Any]:
    http_request = request.Request(_gateway_url(path), method="GET")
    try:
        with request.urlopen(http_request, timeout=timeout_seconds) as response:
            return json.loads(response.read().decode("utf-8"))
    except (TimeoutError, error.URLError, error.HTTPError, json.JSONDecodeError) as exc:
        raise LocalLLMError(f"Unable to reach local LLM gateway at {_gateway_url(path)}: {exc}") from exc


def inspect_local_llm_status() -> dict[str, Any]:
    """Fast, non-generative health check for the configured local/private LLM gateway."""
    settings = get_settings()
    checked_at = datetime.now(UTC)
    timeout_seconds = max(1.0, min(float(settings.local_llm_timeout_seconds), 5.0))
    flags = {
        "extraction": settings.local_llm_enabled,
        "query_routing": settings.llm_query_routing_enabled,
        "answer_synthesis": settings.llm_answer_synthesis_enabled,
        "signal_explanation": settings.llm_signal_explanation_enabled,
    }
    enabled_capability_count = sum(1 for enabled in flags.values() if enabled)

    base_payload: dict[str, Any] = {
        "enabled": settings.local_llm_enabled,
        "configured_model": settings.local_llm_model,
        "base_url": settings.local_llm_base_url,
        "timeout_seconds": settings.local_llm_timeout_seconds,
        "feature_flags": flags,
        "gateway_reachable": False,
        "gateway_status": "disabled" if enabled_capability_count == 0 else "unreachable",
        "available_models": [],
        "configured_model_available": False,
        "checked_at": checked_at,
        "error": None,
    }

    if enabled_capability_count == 0:
        return base_payload

    try:
        payload = _request_json("/api/tags", timeout_seconds=timeout_seconds)
    except LocalLLMError as exc:
        base_payload["error"] = str(exc)
        return base_payload

    models = payload.get("models") if isinstance(payload, dict) else None
    available_models = sorted(
        str(model.get("name"))
        for model in models or []
        if isinstance(model, dict) and isinstance(model.get("name"), str)
    )
    configured_model_available = settings.local_llm_model in available_models
    gateway_status = "ready" if configured_model_available else "model_missing"

    return {
        **base_payload,
        "gateway_reachable": True,
        "gateway_status": gateway_status,
        "available_models": available_models,
        "configured_model_available": configured_model_available,
    }


def run_local_llm_smoke() -> dict[str, Any]:
    """Run a tiny structured generation through the same gateway Izge reasoning uses."""
    settings = get_settings()
    flags = {
        "extraction": settings.local_llm_enabled,
        "query_routing": settings.llm_query_routing_enabled,
        "answer_synthesis": settings.llm_answer_synthesis_enabled,
        "signal_explanation": settings.llm_signal_explanation_enabled,
    }
    if not any(flags.values()):
        return {
            "status": "skipped",
            "model": settings.local_llm_model,
            "duration_ms": 0,
            "message": "Local/private LLM features are disabled.",
            "checked_at": datetime.now(UTC),
            "error": None,
        }

    schema = {
        "type": "object",
        "properties": {
            "ok": {"type": "boolean"},
            "rationale": {"type": "string"},
        },
        "required": ["ok", "rationale"],
        "additionalProperties": False,
    }
    started_at = time.perf_counter()
    try:
        payload = run_structured_local_prompt(
            system_prompt="You are an Izge deployment smoke tester. Return compact JSON only.",
            user_prompt='Return {"ok": true, "rationale": "local/private inference gateway answered"}.',
            schema=schema,
        )
    except LocalLLMError as exc:
        return {
            "status": "failed",
            "model": settings.local_llm_model,
            "duration_ms": int((time.perf_counter() - started_at) * 1000),
            "message": "The configured LLM gateway did not complete a structured smoke response.",
            "checked_at": datetime.now(UTC),
            "error": str(exc),
        }

    passed = payload.get("ok") is True
    return {
        "status": "passed" if passed else "failed",
        "model": settings.local_llm_model,
        "duration_ms": int((time.perf_counter() - started_at) * 1000),
        "message": str(payload.get("rationale") or "Structured response returned."),
        "checked_at": datetime.now(UTC),
        "error": None if passed else "Structured smoke response did not return ok=true.",
    }
