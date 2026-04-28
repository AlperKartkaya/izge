from __future__ import annotations

import json
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError, field_validator

from app.config import get_settings
from app.services.llm import LocalLLMError, run_structured_local_prompt


MAX_CONTEXT_STRING_LENGTH = 900
MAX_CONTEXT_LIST_ITEMS = 12
MAX_CONTEXT_DICT_ITEMS = 36

QUERY_CLASS_LABELS = (
    "Decision lineage",
    "Contradiction analysis",
    "Assumption drift",
    "Next-action guidance",
)


class LLMQueryIntent(BaseModel):
    """LLM-authored routing hint for deterministic query execution."""

    query_class: Literal["Decision lineage", "Contradiction analysis", "Assumption drift", "Next-action guidance"]
    confidence: float = Field(ge=0.0, le=1.0)
    route_rationale: str = Field(min_length=12, max_length=520)
    secondary_signals: list[str] = Field(default_factory=list, max_length=3)
    topic_terms: list[str] = Field(default_factory=list, max_length=8)
    asks_for_evidence: bool = True
    needs_next_action: bool = False

    @field_validator("route_rationale", mode="before")
    @classmethod
    def strip_rationale(cls, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip()
        return value

    @field_validator("secondary_signals")
    @classmethod
    def filter_secondary_signals(cls, value: list[str]) -> list[str]:
        cleaned: list[str] = []
        for item in value:
            if item in QUERY_CLASS_LABELS and item not in cleaned:
                cleaned.append(item)
        return cleaned[:3]

    @field_validator("topic_terms")
    @classmethod
    def clean_topic_terms(cls, value: list[str]) -> list[str]:
        cleaned: list[str] = []
        for item in value:
            if not isinstance(item, str):
                continue
            normalized = " ".join(item.lower().strip().split())
            if 2 <= len(normalized) <= 60 and normalized not in cleaned:
                cleaned.append(normalized)
        return cleaned[:8]


class LLMQueryAnswerSynthesis(BaseModel):
    """LLM-authored final wording for a deterministic query result packet."""

    answer_text: str = Field(min_length=24, max_length=1600)
    why_this_answer: str = Field(min_length=24, max_length=900)
    recommended_next_actions: list[str] = Field(default_factory=list, max_length=4)
    cited_evidence_ids: list[str] = Field(default_factory=list, max_length=8)
    cited_memory_ids: list[str] = Field(default_factory=list, max_length=8)
    confidence_rationale: str | None = Field(default=None, max_length=420)

    @field_validator("answer_text", "why_this_answer", "confidence_rationale", mode="before")
    @classmethod
    def strip_answer_text(cls, value: Any) -> Any:
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return value

    @field_validator("recommended_next_actions", "cited_evidence_ids", "cited_memory_ids")
    @classmethod
    def clean_answer_lists(cls, value: list[str]) -> list[str]:
        cleaned: list[str] = []
        for item in value:
            if isinstance(item, str):
                normalized = " ".join(item.strip().split())
                if normalized and normalized not in cleaned:
                    cleaned.append(normalized)
        return cleaned[:8]


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


def _query_intent_system_prompt() -> str:
    return (
        "You are Izge's local, company-controlled query intent router. Classify the user's question into one of the "
        "fixed MVP reasoning modes only. Do not answer the question, retrieve evidence, invent facts, or create new "
        "memory. Your output only helps deterministic graph execution choose the route and topic focus. Return strict "
        "JSON matching the schema."
    )


def classify_query_intent_with_local_llm(*, query_text: str, deterministic_route: dict[str, Any]) -> LLMQueryIntent:
    """Use the local LLM to route a natural-language query into an MVP reasoning mode.

    This is only a routing hint. Deterministic query execution still performs evidence selection, permission filtering,
    contradiction/drift analysis, and answer composition.
    """

    schema = LLMQueryIntent.model_json_schema()
    context = {
        "routing_boundary": {
            "llm_role": "classify_query_intent_only",
            "deterministic_execution_remains_authority": True,
        },
        "mode_definitions": {
            "Decision lineage": "Use when the user asks why/when/how a decision changed, the history of a topic, or what led to the current state.",
            "Contradiction analysis": "Use when the user asks whether something conflicts with prior history, is inconsistent, or creates tension.",
            "Assumption drift": "Use when the user asks what changed, whether assumptions still hold, or which beliefs became stale/reversed.",
            "Next-action guidance": "Use when the user asks what to do next, needs a recommendation, or asks for a decision/action after evidence.",
        },
        "deterministic_keyword_route": _compact_for_prompt(deterministic_route),
        "query_text": query_text,
    }
    user_prompt = (
        "Classify this Izge query into exactly one MVP reasoning mode. Prefer the user's dominant intent, not generic "
        "search. If the query asks both what changed and what to do, choose Next-action guidance and include Assumption "
        "drift as a secondary signal. If it asks whether a new statement conflicts with history, choose Contradiction "
        "analysis. Extract concise topic_terms that deterministic graph search can use.\n\n"
        f"Context JSON:\n{json.dumps(context, sort_keys=True, default=str)}"
    )
    try:
        parsed = run_structured_local_prompt(system_prompt=_query_intent_system_prompt(), user_prompt=user_prompt, schema=schema)
        return LLMQueryIntent.model_validate(parsed)
    except ValidationError as exc:
        raise LocalLLMError("Local LLM query intent did not match the expected schema") from exc


def _query_answer_system_prompt() -> str:
    return (
        "You are Izge's local, company-controlled answer synthesis helper. Rewrite a final answer only from the "
        "deterministic evidence packet. Do not retrieve, infer hidden facts, invent citations, or alter the selected "
        "query class. If evidence is thin, say so. Return strict JSON matching the schema."
    )


def synthesize_query_answer_with_local_llm(
    *,
    query_text: str,
    query_class: str,
    deterministic_result: dict[str, Any],
) -> LLMQueryAnswerSynthesis:
    """Use the local LLM to improve answer wording from deterministic query evidence.

    The LLM may only rewrite final prose/actions from the provided result packet. Callers must validate returned
    citation IDs against the supplied evidence and memory object IDs before applying the synthesis.
    """

    schema = LLMQueryAnswerSynthesis.model_json_schema()
    context = {
        "synthesis_boundary": {
            "llm_role": "rewrite_answer_from_selected_evidence_only",
            "deterministic_execution_remains_authority": True,
            "must_not_introduce_new_facts": True,
        },
        "query_text": query_text,
        "query_class": query_class,
        "deterministic_result": _compact_for_prompt(deterministic_result),
    }
    user_prompt = (
        "Rewrite this Izge query result into a sharper, evidence-first answer. Preserve the conclusion if the "
        "deterministic result is already specific. Use cited_evidence_ids and cited_memory_ids only from the provided "
        "packet. Keep recommendations concrete but do not add actions unsupported by the packet.\n\n"
        f"Context JSON:\n{json.dumps(context, sort_keys=True, default=str)}"
    )
    try:
        parsed = run_structured_local_prompt(system_prompt=_query_answer_system_prompt(), user_prompt=user_prompt, schema=schema)
        return LLMQueryAnswerSynthesis.model_validate(parsed)
    except ValidationError as exc:
        raise LocalLLMError("Local LLM query answer synthesis did not match the expected schema") from exc


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
