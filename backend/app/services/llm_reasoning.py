from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, Field, ValidationError, field_validator

from app.config import get_settings
from app.services.llm import LocalLLMError, run_structured_local_prompt


MAX_CONTEXT_STRING_LENGTH = 900
MAX_CONTEXT_LIST_ITEMS = 12
MAX_CONTEXT_DICT_ITEMS = 36


class LLMSignalExplanation(BaseModel):
    """LLM-authored wording for a deterministic proactive signal."""

    summary: str = Field(min_length=12, max_length=420)
    grounded_reasoning: str = Field(min_length=24, max_length=1200)
    recommended_action: str | None = Field(default=None, max_length=420)
    confidence_rationale: str | None = Field(default=None, max_length=360)
    cited_artifact_ids: list[str] = Field(default_factory=list)
    cited_memory_ids: list[str] = Field(default_factory=list)
    risk_notes: list[str] = Field(default_factory=list, max_length=4)

    @field_validator("summary", "grounded_reasoning", "recommended_action", "confidence_rationale", mode="before")
    @classmethod
    def strip_optional_text(cls, value: Any) -> Any:
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return value

    @field_validator("cited_artifact_ids", "cited_memory_ids", "risk_notes")
    @classmethod
    def trim_lists(cls, value: list[str]) -> list[str]:
        cleaned: list[str] = []
        for item in value:
            if isinstance(item, str) and item.strip() and item.strip() not in cleaned:
                cleaned.append(item.strip())
        return cleaned[:8]


def _compact_for_prompt(value: Any, *, depth: int = 0) -> Any:
    if depth > 4:
        return "[truncated]"
    if isinstance(value, str):
        return value if len(value) <= MAX_CONTEXT_STRING_LENGTH else f"{value[:MAX_CONTEXT_STRING_LENGTH]}…"
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    if isinstance(value, list):
        return [_compact_for_prompt(item, depth=depth + 1) for item in value[:MAX_CONTEXT_LIST_ITEMS]]
    if isinstance(value, dict):
        compact: dict[str, Any] = {}
        for index, (key, item) in enumerate(value.items()):
            if index >= MAX_CONTEXT_DICT_ITEMS:
                compact["_truncated"] = True
                break
            compact[str(key)] = _compact_for_prompt(item, depth=depth + 1)
        return compact
    return str(value)


def _collect_allowed_ids(value: Any) -> tuple[set[str], set[str]]:
    artifact_ids: set[str] = set()
    memory_ids: set[str] = set()

    def visit(item: Any, key_hint: str = "") -> None:
        if isinstance(item, dict):
            for key, nested in item.items():
                visit(nested, str(key))
            return
        if isinstance(item, list):
            for nested in item:
                visit(nested, key_hint)
            return
        if not isinstance(item, str) or not item.strip():
            return
        value_text = item.strip()
        if key_hint.endswith("artifact_id") or value_text.startswith("art_"):
            artifact_ids.add(value_text)
        if (
            key_hint.endswith("memory_id")
            or key_hint in {"from_id", "to_id", "assumption_id", "supporting_signal_memory_id", "entity_id"}
            or value_text.startswith(("dec_", "asm_", "con_", "out_", "com_"))
        ):
            memory_ids.add(value_text)

    visit(value)
    return artifact_ids, memory_ids


def _filter_to_allowed(returned_ids: list[str], allowed_ids: set[str]) -> list[str]:
    if not allowed_ids:
        return []
    return [item for item in returned_ids if item in allowed_ids]


def _signal_explanation_system_prompt() -> str:
    return (
        "You are Izge's local, company-controlled inference helper. Rewrite proactive signal explanations only. "
        "The deterministic graph engine has already detected and classified the signal; do not invent a new signal, "
        "new memory object, new artifact, or unsupported claim. Use only the provided JSON context. Keep the wording "
        "serious, evidence-first, and implementation-aware. Return strict JSON matching the schema."
    )


def explain_signal_with_local_llm(
    *,
    signal_type: str,
    title: str,
    summary: str,
    related_topic: str,
    grounded_reasoning: str,
    recommended_action: str | None,
    payload_json: dict[str, Any],
) -> LLMSignalExplanation:
    """Use the local LLM to improve wording for a deterministic signal.

    The returned explanation is intentionally constrained to presentation fields. It must not be used to create graph
    edges, memory objects, or signal classifications.
    """

    settings = get_settings()
    allowed_artifact_ids, allowed_memory_ids = _collect_allowed_ids(payload_json)
    schema = LLMSignalExplanation.model_json_schema()
    context = {
        "signal_boundary": {
            "detected_by": "deterministic_graph_analysis",
            "llm_role": "explain_existing_signal_only",
            "must_not_create_new_facts": True,
        },
        "signal": {
            "type": signal_type,
            "title": title,
            "topic": related_topic,
            "deterministic_summary": summary,
            "deterministic_grounded_reasoning": grounded_reasoning,
            "deterministic_recommended_action": recommended_action,
        },
        "allowed_citation_ids": {
            "artifact_ids": sorted(allowed_artifact_ids),
            "memory_ids": sorted(allowed_memory_ids),
        },
        "evidence_payload": _compact_for_prompt(payload_json),
    }
    user_prompt = (
        "Improve the human-facing explanation for this existing Izge proactive signal. "
        "The signal type and evidence are already fixed. The summary should explain what changed; grounded_reasoning "
        "should name why the evidence creates tension, drift, supersession, or action pressure; recommended_action should "
        "be concrete but only if supported. Cite only IDs from allowed_citation_ids.\n\n"
        f"Context JSON:\n{json.dumps(context, sort_keys=True, default=str)}"
    )

    try:
        parsed = run_structured_local_prompt(system_prompt=_signal_explanation_system_prompt(), user_prompt=user_prompt, schema=schema)
        explanation = LLMSignalExplanation.model_validate(parsed)
    except ValidationError as exc:
        raise LocalLLMError("Local LLM signal explanation did not match the expected schema") from exc

    explanation.cited_artifact_ids = _filter_to_allowed(explanation.cited_artifact_ids, allowed_artifact_ids)
    explanation.cited_memory_ids = _filter_to_allowed(explanation.cited_memory_ids, allowed_memory_ids)
    if not explanation.recommended_action:
        explanation.recommended_action = recommended_action
    if settings.local_llm_model and not explanation.confidence_rationale:
        explanation.confidence_rationale = "Generated from deterministic signal context using the configured local LLM."
    return explanation
