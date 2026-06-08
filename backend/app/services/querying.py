from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
import hashlib
import re
from time import perf_counter
from typing import Any

from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import (
    Artifact,
    ArtifactChunk,
    Assumption,
    Commitment,
    Constraint,
    Decision,
    GraphEdge,
    GraphNode,
    OrchestrationStageRun,
    Outcome,
    QueryRun,
    QueryTraceStep,
    Signal,
    User,
)
from app.schemas.api import (
    EvidenceReference,
    GraphNeighborhood,
    GraphNeighborhoodNeighbor,
    GraphTimelineItem,
    MemoryReference,
    QueryResult,
    QueryTraceRead,
    QueryTraceStepRead,
    SignalDetail,
    SignalIntelligenceStep,
    SignalRead,
)
from app.services.audit import log_event
from app.services.llm_reasoning import (
    classify_query_intent_with_local_llm,
    explain_signal_with_local_llm,
    synthesize_query_answer_with_local_llm,
)
from app.services.permissions import artifact_is_visible_to_user
from app.services.orchestration_runtime import run_bounded_parallel_stage_packets
from app.services.query_context import (
    build_bounded_orchestration_payload,
    build_context_packet,
    build_provenance_verifier_result,
    stable_payload_size_bytes,
)

STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "how",
    "if",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "our",
    "that",
    "the",
    "their",
    "this",
    "to",
    "was",
    "we",
    "what",
    "which",
    "why",
    "with",
}

CONTRADICTION_ACTION_TERMS = {
    "decided",
    "decision",
    "move",
    "moved",
    "moving",
    "launch",
    "target",
    "late",
    "early",
    "reintroduce",
    "reintroduced",
    "support",
    "activation",
    "prioritize",
    "prioritized",
    "foundation",
    "work",
    "prepare",
    "publish",
    "decide",
    "decides",
    "keep",
    "revert",
    "roadmap",
    "plan",
    "plans",
    "q1",
    "q2",
    "q3",
    "q4",
    "2024",
    "2025",
    "2026",
    "2027",
}


@dataclass(frozen=True)
class MemoryRecord:
    memory_type: str
    memory_id: str
    title_or_label: str
    normalized_text: str
    confidence_score: float
    event_timestamp: datetime
    source_artifact_id: str
    source_artifact_review_status: str
    source_chunk_id: str | None
    evidence_span: str | None
    topic_key: str
    status: str | None = None
    due_date: datetime | None = None
    owner_label: str | None = None


@dataclass(frozen=True)
class NodeRecord:
    node_id: str
    node_type: str
    entity_id: str
    title_or_label: str


@dataclass(frozen=True)
class QueryRouteDecision:
    query_class: str
    route_confidence: float
    route_rationale: str
    secondary_signals: list[str]
    route_source: str = "keyword"
    topic_terms: list[str] = field(default_factory=list)
    llm_intent: dict[str, Any] | None = None


def _query_terms(value: str) -> set[str]:
    return {token for token in re.findall(r"[a-z0-9]+", value.lower()) if token not in STOPWORDS and len(token) > 2}


def _text_overlap(left: str, right: str) -> int:
    return len(_query_terms(left) & _query_terms(right))


def _contradiction_family_terms(memory: MemoryRecord) -> set[str]:
    tokens = _query_terms(f"{memory.title_or_label} {memory.normalized_text}")
    return {token for token in tokens if token not in CONTRADICTION_ACTION_TERMS}


def _contradiction_family_key(memory: MemoryRecord) -> str:
    tokens = sorted(_contradiction_family_terms(memory))
    if not tokens:
        return memory.topic_key
    return " ".join(tokens[:4])


def _is_contradiction_comparable_pair(from_memory: MemoryRecord, to_memory: MemoryRecord) -> bool:
    pair = {from_memory.memory_type, to_memory.memory_type}
    if pair not in ({"decision"}, {"decision", "commitment"}, {"commitment"}):
        return False
    from_terms = _contradiction_family_terms(from_memory)
    to_terms = _contradiction_family_terms(to_memory)
    if not from_terms or not to_terms:
        return False
    return len(from_terms & to_terms) >= 2


def _classify_query_with_keywords(query_text: str) -> QueryRouteDecision:
    lowered = query_text.lower()
    scores = {
        "Decision lineage": 0,
        "Contradiction analysis": 0,
        "Assumption drift": 0,
        "Next-action guidance": 0,
    }
    matched_terms: dict[str, list[str]] = {label: [] for label in scores}
    for term in ("contradict", "conflict", "tension", "oppose", "inconsistent"):
        if term in lowered:
            scores["Contradiction analysis"] += 2
            matched_terms["Contradiction analysis"].append(term)
    for term in ("assumption", "stale", "drift", "outdated", "still valid"):
        if term in lowered:
            scores["Assumption drift"] += 2
            matched_terms["Assumption drift"].append(term)
    for term in ("next", "should", "recommend", "action", "now", "do next"):
        if term in lowered:
            scores["Next-action guidance"] += 2
            matched_terms["Next-action guidance"].append(term)
    for term in ("decide", "decision", "why", "when", "lineage", "history"):
        if term in lowered:
            scores["Decision lineage"] += 1
            matched_terms["Decision lineage"].append(term)

    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    best_class, best_score = ranked[0]
    second_score = ranked[1][1]
    if best_score == 0:
        return QueryRouteDecision(
            query_class="Decision lineage",
            route_confidence=0.3,
            route_rationale="No explicit mode keywords matched, so the query fell back to the baseline historical-lineage route.",
            secondary_signals=[],
            topic_terms=sorted(_query_terms(query_text))[:8],
        )
    confidence = min(0.98, 0.45 + (best_score * 0.12) + ((best_score - second_score) * 0.08))
    return QueryRouteDecision(
        query_class=best_class,
        route_confidence=round(confidence, 2),
        route_rationale=f"Matched route terms: {', '.join(matched_terms[best_class])}.",
        secondary_signals=[label for label, score in ranked[1:] if score > 0][:2],
        topic_terms=sorted(_query_terms(query_text))[:8],
    )


def _route_decision_trace_payload(route_decision: QueryRouteDecision) -> dict[str, Any]:
    payload = {
        "query_class": route_decision.query_class,
        "route_confidence": route_decision.route_confidence,
        "route_rationale": route_decision.route_rationale,
        "secondary_signals": route_decision.secondary_signals,
        "route_source": route_decision.route_source,
        "topic_terms": route_decision.topic_terms,
    }
    if route_decision.llm_intent is not None:
        payload["llm_intent"] = route_decision.llm_intent
    return payload


def _evidence_reference_id(evidence: EvidenceReference) -> str:
    return f"{evidence.artifact_id}:{evidence.chunk_id or 'artifact'}:{evidence.evidence_kind or 'evidence'}"


def _answer_synthesis_context(result_data: dict[str, Any]) -> dict[str, Any]:
    supporting_nodes = [node for node in result_data.get("supporting_nodes", []) if isinstance(node, MemoryReference)]
    supporting_evidence = [item for item in result_data.get("supporting_evidence", []) if isinstance(item, EvidenceReference)]
    return {
        "answer_text": result_data.get("answer_text"),
        "why_this_answer": result_data.get("why_this_answer"),
        "supporting_nodes": [
            {
                "memory_id": node.memory_id,
                "memory_type": node.memory_type,
                "title_or_label": node.title_or_label,
                "source_artifact_id": node.source_artifact_id,
                "source_artifact_review_status": node.source_artifact_review_status,
                "status": node.status,
                "due_date": node.due_date,
            }
            for node in supporting_nodes[:8]
        ],
        "supporting_evidence": [
            {
                "evidence_id": _evidence_reference_id(evidence),
                "artifact_id": evidence.artifact_id,
                "artifact_title": evidence.artifact_title,
                "artifact_review_status": evidence.artifact_review_status,
                "chunk_id": evidence.chunk_id,
                "evidence_kind": evidence.evidence_kind,
                "excerpt": evidence.excerpt,
            }
            for evidence in supporting_evidence[:8]
        ],
        "contradictions": result_data.get("contradictions", [])[:4],
        "stale_assumptions": result_data.get("stale_assumptions", [])[:4],
        "recommended_next_actions": result_data.get("recommended_next_actions", [])[:4],
        "uncertainty_notes": result_data.get("uncertainty_notes", []),
    }


def _apply_optional_llm_answer_synthesis(
    *,
    query_text: str,
    query_class: str,
    result_data: dict[str, Any],
    conversation_context: str | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    synthesis_boundary = {
        "status": "disabled",
        "role": "rewrite_answer_from_selected_evidence_only",
        "model": settings.local_llm_model,
    }
    result_data["answer_synthesis"] = synthesis_boundary
    if not settings.llm_answer_synthesis_enabled:
        return result_data

    context = _answer_synthesis_context(result_data)
    allowed_evidence_ids = {
        item["evidence_id"] for item in context["supporting_evidence"] if isinstance(item.get("evidence_id"), str)
    }
    allowed_memory_ids = {item["memory_id"] for item in context["supporting_nodes"] if isinstance(item.get("memory_id"), str)}
    try:
        synthesis = synthesize_query_answer_with_local_llm(
            query_text=query_text,
            query_class=query_class,
            deterministic_result=context,
            conversation_context=conversation_context,
        )
    except Exception as exc:
        result_data["answer_synthesis"] = {
            **synthesis_boundary,
            "status": "fallback",
            "fallback_reason": str(exc),
        }
        return result_data

    cited_evidence_ids = [item for item in synthesis.cited_evidence_ids if item in allowed_evidence_ids]
    cited_memory_ids = [item for item in synthesis.cited_memory_ids if item in allowed_memory_ids]
    result_data["answer_text"] = synthesis.answer_text
    result_data["why_this_answer"] = synthesis.why_this_answer
    if synthesis.recommended_next_actions:
        result_data["recommended_next_actions"] = synthesis.recommended_next_actions
    result_data["answer_synthesis"] = {
        **synthesis_boundary,
        "status": "applied",
        "cited_evidence_ids": cited_evidence_ids,
        "cited_memory_ids": cited_memory_ids,
        "confidence_rationale": synthesis.confidence_rationale,
        "deterministic_answer_preserved_as_source": context["answer_text"],
    }
    return result_data


def classify_query_with_trace(query_text: str) -> QueryRouteDecision:
    keyword_decision = _classify_query_with_keywords(query_text)
    settings = get_settings()
    if not settings.llm_query_routing_enabled:
        return keyword_decision

    try:
        llm_intent = classify_query_intent_with_local_llm(
            query_text=query_text,
            deterministic_route=_route_decision_trace_payload(keyword_decision),
        )
    except Exception as exc:
        return QueryRouteDecision(
            query_class=keyword_decision.query_class,
            route_confidence=keyword_decision.route_confidence,
            route_rationale=f"{keyword_decision.route_rationale} Local LLM routing fallback: {exc}",
            secondary_signals=keyword_decision.secondary_signals,
            route_source="keyword_after_llm_fallback",
            topic_terms=keyword_decision.topic_terms,
            llm_intent={"status": "fallback", "fallback_reason": str(exc)},
        )

    llm_confidence = round(float(llm_intent.confidence), 2)
    combined_confidence = max(0.35, min(0.98, (llm_confidence * 0.72) + (keyword_decision.route_confidence * 0.28)))
    secondary_signals = [
        item
        for item in [*llm_intent.secondary_signals, *keyword_decision.secondary_signals]
        if item != llm_intent.query_class
    ][:3]
    return QueryRouteDecision(
        query_class=llm_intent.query_class,
        route_confidence=round(combined_confidence, 2),
        route_rationale=(
            f"Local LLM classified the query intent as {llm_intent.query_class}: {llm_intent.route_rationale} "
            f"Deterministic keyword fallback would route to {keyword_decision.query_class}."
        ),
        secondary_signals=secondary_signals,
        route_source="local_llm_intent",
        topic_terms=llm_intent.topic_terms or keyword_decision.topic_terms,
        llm_intent={
            "status": "applied",
            "query_class": llm_intent.query_class,
            "confidence": llm_confidence,
            "secondary_signals": llm_intent.secondary_signals,
            "topic_terms": llm_intent.topic_terms,
            "asks_for_evidence": llm_intent.asks_for_evidence,
            "needs_next_action": llm_intent.needs_next_action,
            "deterministic_fallback_class": keyword_decision.query_class,
            "role": "classify_query_intent_only",
        },
    )


def classify_query(query_text: str) -> str:
    return classify_query_with_trace(query_text).query_class


def _visible_artifacts(db: Session, user: User) -> list[Artifact]:
    artifacts = db.scalars(select(Artifact).where(Artifact.workspace_id == user.workspace_id).order_by(Artifact.created_at.desc())).all()
    return [artifact for artifact in artifacts if artifact_is_visible_to_user(db, artifact, user)]


def _visible_artifact_ids(db: Session, user: User) -> set[str]:
    return {artifact.artifact_id for artifact in _visible_artifacts(db, user)}


def _trusted_visible_artifacts(db: Session, user: User) -> list[Artifact]:
    return [artifact for artifact in _visible_artifacts(db, user) if artifact.review_status != "rejected"]


def _trusted_visible_artifact_ids(db: Session, user: User) -> set[str]:
    return {artifact.artifact_id for artifact in _trusted_visible_artifacts(db, user)}


def _review_priority_visible_artifact_ids(db: Session, user: User) -> set[str]:
    """Prefer reviewed artifacts for employee graph surfaces, with an empty-workspace fallback.

    Query/review flows can still expose submitted items where appropriate, but the graph is an
    employee-facing memory map. If reviewed sources exist, keep draft/local-test uploads out of
    that map so the page remains a deployable company graph rather than a mixed scratchpad.
    """

    artifacts = _trusted_visible_artifacts(db, user)
    reviewed_artifact_ids = {artifact.artifact_id for artifact in artifacts if artifact.review_status == "reviewed"}
    return reviewed_artifact_ids or {artifact.artifact_id for artifact in artifacts}


def _artifact_review_status_map(db: Session, artifact_ids: set[str]) -> dict[str, str]:
    if not artifact_ids:
        return {}
    artifacts = db.scalars(select(Artifact).where(Artifact.artifact_id.in_(artifact_ids))).all()
    return {artifact.artifact_id: artifact.review_status or "submitted" for artifact in artifacts}


def _artifact_review_status_for_id(review_statuses: dict[str, str], artifact_id: str | None) -> str:
    if artifact_id is None:
        return "unknown"
    return review_statuses.get(artifact_id, "unknown")


def _load_memory_records(db: Session, user: User) -> list[MemoryRecord]:
    trusted_artifacts = _trusted_visible_artifacts(db, user)
    trusted_artifact_review_statuses = {artifact.artifact_id: artifact.review_status or "submitted" for artifact in trusted_artifacts}
    records: list[MemoryRecord] = []
    model_configs = [
        (Decision, "decision", "decision_id"),
        (Assumption, "assumption", "assumption_id"),
        (Constraint, "constraint", "constraint_id"),
        (Outcome, "outcome", "outcome_id"),
        (Commitment, "commitment", "commitment_id"),
    ]
    for model, label, pk_name in model_configs:
        rows = db.scalars(select(model).where(model.workspace_id == user.workspace_id).order_by(model.event_timestamp.asc())).all()
        for row in rows:
            if row.source_artifact_id not in trusted_artifact_review_statuses:
                continue
            records.append(
                MemoryRecord(
                    memory_type=label,
                    memory_id=getattr(row, pk_name),
                    title_or_label=row.title_or_label,
                    normalized_text=row.normalized_text,
                    confidence_score=row.confidence_score,
                    event_timestamp=row.event_timestamp,
                    source_artifact_id=row.source_artifact_id,
                    source_artifact_review_status=trusted_artifact_review_statuses[row.source_artifact_id],
                    source_chunk_id=row.source_chunk_id,
                    evidence_span=row.evidence_span,
                    topic_key=row.topic_key,
                    status=getattr(row, "status", None),
                    due_date=getattr(row, "due_date", None),
                    owner_label=getattr(row, "owner_label", None),
                )
            )
    return records


def _load_nodes_by_id(db: Session, user: User) -> dict[str, NodeRecord]:
    trusted_artifact_ids = _trusted_visible_artifact_ids(db, user)
    nodes = db.scalars(select(GraphNode).where(GraphNode.workspace_id == user.workspace_id)).all()
    allowed_entity_ids = set(trusted_artifact_ids)
    for memory in _load_memory_records(db, user):
        allowed_entity_ids.add(memory.memory_id)
    return {
        node.node_id: NodeRecord(node_id=node.node_id, node_type=node.node_type, entity_id=node.entity_id, title_or_label=node.title_or_label)
        for node in nodes
        if node.entity_id in allowed_entity_ids
    }


def _memory_reference(memory: MemoryRecord) -> MemoryReference:
    return MemoryReference(
        memory_type=memory.memory_type,
        memory_id=memory.memory_id,
        title_or_label=memory.title_or_label,
        confidence_score=memory.confidence_score,
        source_artifact_id=memory.source_artifact_id,
        source_artifact_review_status=memory.source_artifact_review_status,
        topic_key=memory.topic_key,
        status=memory.status,
        due_date=memory.due_date,
        owner_label=memory.owner_label,
    )


def _chunk_excerpt(db: Session, chunk_id: str | None, fallback: str) -> str:
    if not chunk_id:
        return fallback[:240]
    chunk = db.scalar(select(ArtifactChunk).where(ArtifactChunk.chunk_id == chunk_id))
    if chunk is None:
        return fallback[:240]
    return (chunk.text[:240] + "...") if len(chunk.text) > 240 else chunk.text


def _artifact_title_map(db: Session, artifact_ids: set[str]) -> dict[str, str]:
    if not artifact_ids:
        return {}
    artifacts = db.scalars(select(Artifact).where(Artifact.artifact_id.in_(artifact_ids))).all()
    return {artifact.artifact_id: artifact.title for artifact in artifacts}


def _artifact_title_for_id(titles: dict[str, str], artifact_id: str | None) -> str:
    if artifact_id is None:
        return "Unknown artifact"
    return titles.get(artifact_id, artifact_id)


def _evidence_excerpt(db: Session, *, chunk_id: str | None, fallback: str) -> str:
    excerpt = _chunk_excerpt(db, chunk_id, fallback)
    return re.sub(r"\s+", " ", excerpt).strip()


def _contradiction_side_evidence(
    db: Session,
    *,
    memory: MemoryRecord,
    artifact_titles: dict[str, str],
    artifact_review_statuses: dict[str, str],
    time_label: str,
) -> dict[str, str | None]:
    artifact_title = _artifact_title_for_id(artifact_titles, memory.source_artifact_id)
    return {
        "artifact_id": memory.source_artifact_id,
        "artifact_title": artifact_title,
        "artifact_review_status": _artifact_review_status_for_id(artifact_review_statuses, memory.source_artifact_id),
        "chunk_id": memory.source_chunk_id,
        "excerpt": _evidence_excerpt(db, chunk_id=memory.source_chunk_id, fallback=memory.evidence_span or memory.normalized_text),
        "provenance": f"{time_label.capitalize()} claim evidence from {artifact_title}.",
        "time_label": time_label,
    }


def _contradiction_provenance(
    *,
    artifact_title: str,
    chunk_id: str | None,
    from_title: str,
    to_title: str,
) -> tuple[str, str | None]:
    if chunk_id:
        return (
            f"Direct contradiction excerpt from {artifact_title} supporting the later-vs-earlier conflict between '{from_title}' and '{to_title}'.",
            None,
        )
    return (
        f"Graph contradiction link tied to {artifact_title}, but no direct quoted chunk was preserved for the conflict between '{from_title}' and '{to_title}'.",
        "No direct excerpt is attached to this contradiction edge.",
    )


def _drift_provenance(*, artifact_title: str, chunk_id: str | None, assumption_title: str, signal_title: str | None) -> tuple[str, str | None]:
    if signal_title and chunk_id:
        return (
            f"Direct later-signal excerpt from {artifact_title} showing why '{assumption_title}' no longer holds against '{signal_title}'.",
            None,
        )
    if signal_title:
        return (
            f"Later signal from {artifact_title} was linked to '{assumption_title}', but no direct quoted chunk was preserved for '{signal_title}'.",
            "No direct later signal excerpt could be surfaced for this drift item.",
        )
    return (
        f"Persisted assumption status from {artifact_title} without a directly linked later signal.",
        "No direct later signal could be linked for this drift item.",
    )


def _drift_signal_sort_key(signal: MemoryRecord, *, assumption: Assumption, query_text: str) -> tuple[int, int, int, datetime, float]:
    signal_text = f"{signal.title_or_label} {signal.normalized_text}"
    return (
        1 if signal.source_chunk_id else 0,
        _text_overlap(signal_text, query_text),
        _text_overlap(signal_text, f"{assumption.title_or_label} {assumption.normalized_text}"),
        signal.event_timestamp,
        signal.confidence_score,
    )


def _payload_item_visible(item: dict[str, Any], artifact_keys: list[str], visible_artifact_ids: set[str]) -> bool:
    artifact_ids = {item.get(key) for key in artifact_keys if item.get(key) is not None}
    return all(isinstance(artifact_id, str) and artifact_id in visible_artifact_ids for artifact_id in artifact_ids)


def _memory_trace_payload_items(nodes: list[MemoryReference]) -> list[dict[str, Any]]:
    return [
        {
            "memory_type": node.memory_type,
            "memory_id": node.memory_id,
            "title_or_label": node.title_or_label,
            "source_artifact_id": node.source_artifact_id,
            "source_artifact_review_status": node.source_artifact_review_status,
        }
        for node in nodes[:6]
    ]


def _evidence_trace_payload_items(evidence: list[EvidenceReference]) -> list[dict[str, Any]]:
    return [
        {
            "artifact_id": item.artifact_id,
            "artifact_title": item.artifact_title,
            "artifact_review_status": item.artifact_review_status,
            "chunk_id": item.chunk_id,
            "evidence_kind": item.evidence_kind,
            "excerpt": item.excerpt,
            "why_selected": "Selected as visible evidence supporting the final answer packet.",
        }
        for item in evidence[:6]
    ]


def _contradiction_trace_payload_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "from_title": item["from_title"],
            "to_title": item["to_title"],
            "from_source_artifact_id": item["from_source_artifact_id"],
            "to_source_artifact_id": item["to_source_artifact_id"],
            "claim_family_key": item.get("claim_family_key"),
        }
        for item in items[:4]
    ]


def _drift_trace_payload_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "title_or_label": item["title_or_label"],
            "status": item["status"],
            "source_artifact_id": item["source_artifact_id"],
            "supporting_signal_source_artifact_id": item.get("supporting_signal_source_artifact_id"),
        }
        for item in items[:4]
    ]


def _safe_next_actions_from_payload(
    contradictions: list[dict[str, Any]],
    stale_assumptions: list[dict[str, Any]],
    supporting_nodes: list[dict[str, Any]],
) -> list[str]:
    actions: list[str] = []
    if contradictions:
        top = contradictions[0]
        actions.append(f"Resolve the conflict between {top['from_title']} and {top['to_title']} before committing to the current roadmap path.")
    if stale_assumptions:
        top = stale_assumptions[0]
        actions.append(f"Revalidate the assumption '{top['title_or_label']}' because later evidence now marks it {top['status']}.")
    commitment_nodes = [node for node in supporting_nodes if node.get("memory_type") == "commitment"]
    if commitment_nodes:
        commitment = sorted(
            commitment_nodes,
            key=lambda node: (
                0 if isinstance(node.get("due_date"), str) and node.get("due_date") else 1,
                node.get("due_date") or "9999-12-31",
            ),
        )[0]
        due_date = commitment.get("due_date")
        owner_label = commitment.get("owner_label")
        if isinstance(due_date, str) and due_date:
            owner_text = f" for {owner_label}" if isinstance(owner_label, str) and owner_label else ""
            actions.append(
                f"Review the open commitment{owner_text} due on {due_date[:10]}: '{commitment['title_or_label']}'."
            )
        else:
            actions.append(
                f"Review the open commitment '{commitment['title_or_label']}' and confirm whether its due path is still realistic."
            )
    return actions[:3]


def _stable_signal_id(prefix: str, *parts: str | None) -> str:
    material = "|".join(part or "" for part in parts)
    digest = hashlib.sha256(material.encode("utf-8")).hexdigest()[:16]
    return f"{prefix}_{digest}"


def _redacted_query_text(
    *,
    query_class: str,
    contradictions: list[dict[str, Any]],
    stale_assumptions: list[dict[str, Any]],
    supporting_nodes: list[dict[str, Any]],
) -> tuple[str, str, list[str]]:
    recommended_next_actions = _safe_next_actions_from_payload(contradictions, stale_assumptions, supporting_nodes)
    why_this_answer = "Some previously cached support is no longer visible or trusted, so this result was reduced to the currently permitted and review-accepted evidence only."

    if query_class == "Contradiction analysis":
        if contradictions:
            top = contradictions[0]
            answer_text = f"The clearest contradiction still visible is between {top['from_title']} and {top['to_title']}."
        else:
            answer_text = "No contradiction can be shown from the currently permitted and review-accepted evidence."
            recommended_next_actions = []
        return answer_text, why_this_answer, recommended_next_actions

    if query_class == "Assumption drift":
        if stale_assumptions:
            top = stale_assumptions[0]
            answer_text = f"The strongest drift signal still visible is {top['title_or_label']} with status {top['status']}."
        else:
            answer_text = "No stale-assumption signal can be shown from the currently permitted and review-accepted evidence."
            recommended_next_actions = []
        return answer_text, why_this_answer, recommended_next_actions

    if query_class == "Next-action guidance":
        answer_text = recommended_next_actions[0] if recommended_next_actions else "No high-confidence next action can be shown from the currently permitted and review-accepted evidence."
        return answer_text, why_this_answer, recommended_next_actions

    visible_decisions = [node for node in supporting_nodes if node.get("memory_type") == "decision"]
    if len(visible_decisions) >= 2:
        answer_text = (
            f"The visible lineage starts with '{visible_decisions[-1]['title_or_label']}' and later shifts to '{visible_decisions[0]['title_or_label']}'."
        )
    elif visible_decisions:
        answer_text = f"The clearest visible decision lineage is '{visible_decisions[0]['title_or_label']}'."
    else:
        answer_text = "No decision lineage can be shown from the currently permitted and review-accepted evidence."
        recommended_next_actions = []
    return answer_text, why_this_answer, recommended_next_actions


def _evidence_from_memories(db: Session, memories: list[MemoryRecord]) -> list[EvidenceReference]:
    titles = _artifact_title_map(db, {memory.source_artifact_id for memory in memories})
    evidence: list[EvidenceReference] = []
    seen: set[tuple[str, str | None]] = set()
    for memory in memories:
        key = (memory.source_artifact_id, memory.source_chunk_id)
        if key in seen:
            continue
        seen.add(key)
        evidence.append(
            EvidenceReference(
                artifact_id=memory.source_artifact_id,
                artifact_title=_artifact_title_for_id(titles, memory.source_artifact_id),
                artifact_review_status=memory.source_artifact_review_status,
                chunk_id=memory.source_chunk_id,
                excerpt=_chunk_excerpt(db, memory.source_chunk_id, memory.evidence_span or memory.normalized_text),
                evidence_kind="graph",
            )
        )
    return evidence[:8]


def _fts_evidence(db: Session, user: User, query_text: str) -> list[EvidenceReference]:
    search_terms = [term for term in _query_terms(query_text)][:6]
    if not search_terms:
        return []
    query = text(
        "SELECT chunk_id, artifact_id, text FROM artifact_chunks_fts WHERE workspace_id = :workspace_id AND artifact_chunks_fts MATCH :match LIMIT 24"
    ).bindparams(workspace_id=user.workspace_id, match=" OR ".join(f'\"{term}\"' for term in search_terms))
    try:
        rows = db.execute(query).all()
    except Exception:
        return []
    artifact_ids = {artifact_id for _chunk_id, artifact_id, _text_value in rows}
    titles = _artifact_title_map(db, artifact_ids)
    trusted_artifact_ids = _trusted_visible_artifact_ids(db, user)
    review_statuses = _artifact_review_status_map(db, trusted_artifact_ids)
    evidence: list[EvidenceReference] = []
    for chunk_id, artifact_id, text_value in rows:
        if artifact_id not in trusted_artifact_ids:
            continue
        artifact_id_text = artifact_id if isinstance(artifact_id, str) else None
        chunk_id_text = chunk_id if isinstance(chunk_id, str) else None
        text_excerpt = text_value if isinstance(text_value, str) else str(text_value)
        evidence.append(
            EvidenceReference(
                artifact_id=artifact_id_text or "unknown-artifact",
                artifact_title=_artifact_title_for_id(titles, artifact_id_text),
                artifact_review_status=_artifact_review_status_for_id(review_statuses, artifact_id_text),
                chunk_id=chunk_id_text,
                excerpt=(text_excerpt[:240] + "...") if len(text_excerpt) > 240 else text_excerpt,
                evidence_kind="search_fallback",
            )
        )
    return evidence[:8]


def _visible_edges(db: Session, user: User) -> list[GraphEdge]:
    trusted_artifact_ids = _trusted_visible_artifact_ids(db, user)
    edges = db.scalars(select(GraphEdge).where(GraphEdge.workspace_id == user.workspace_id).order_by(GraphEdge.created_at.desc())).all()
    return [edge for edge in edges if edge.evidence_artifact_id is None or edge.evidence_artifact_id in trusted_artifact_ids]


def _related_memories_for_node(db: Session, user: User, node_id: str) -> list[MemoryRecord]:
    nodes = _load_nodes_by_id(db, user)
    memories = {memory.memory_id: memory for memory in _load_memory_records(db, user)}
    related: list[MemoryRecord] = []
    for edge in _visible_edges(db, user):
        if edge.from_node_id != node_id and edge.to_node_id != node_id:
            continue
        other_node_id = edge.to_node_id if edge.from_node_id == node_id else edge.from_node_id
        other_node = nodes.get(other_node_id)
        if other_node is None:
            continue
        memory = memories.get(other_node.entity_id)
        if memory is not None:
            related.append(memory)
    return related


def _memory_rank(memories: list[MemoryRecord], query_text: str, preferred_type: str | None = None) -> list[MemoryRecord]:
    query_terms = _query_terms(query_text)
    ranked = sorted(
        memories,
        key=lambda memory: (
            1 if preferred_type and memory.memory_type == preferred_type else 0,
            1 if memory.topic_key != "general" and any(term in memory.topic_key for term in query_terms) else 0,
            _text_overlap(memory.title_or_label + " " + memory.normalized_text, query_text),
            memory.confidence_score,
            memory.event_timestamp,
        ),
        reverse=True,
    )
    return ranked


def _lineage_result(db: Session, user: User, query_text: str) -> dict:
    memories = _load_memory_records(db, user)
    decisions = _memory_rank([memory for memory in memories if memory.memory_type == "decision"], query_text, preferred_type="decision")
    selected = decisions[:2]
    if not selected:
        return {
            "answer_text": "No decision lineage could be reconstructed from the currently permitted artifacts.",
            "why_this_answer": "No visible decision objects matched the submitted question closely enough to assemble a lineage path.",
            "supporting_nodes": [],
            "supporting_evidence": _fts_evidence(db, user, query_text),
            "contradictions": [],
            "stale_assumptions": [],
            "recommended_next_actions": [],
            "uncertainty_notes": ["No visible decision records matched the requested topic."],
        }
    selected_topic_keys = {decision.topic_key for decision in selected if decision.topic_key != "general"}
    related: list[MemoryRecord] = []
    for decision in selected:
        related.extend(_related_memories_for_node(db, user, _node_id_for_memory(db, user, decision)))
    supporting = selected + [memory for memory in related if not selected_topic_keys or memory.topic_key in selected_topic_keys]
    supporting = _dedupe_memories(supporting)[:8]
    if len(selected) == 1:
        answer_text = f"The clearest decision lineage in scope is '{selected[0].title_or_label}', recorded on {selected[0].event_timestamp.strftime('%Y-%m-%d')}."
    else:
        answer_text = (
            f"The lineage starts with '{selected[-1].title_or_label}' on {selected[-1].event_timestamp.strftime('%Y-%m-%d')} "
            f"and later shifts to '{selected[0].title_or_label}' on {selected[0].event_timestamp.strftime('%Y-%m-%d')}."
        )
    why_this_answer = "Lineage was assembled from the highest-ranked decision records on the same topic and then tightened to directly linked evidence-bearing objects only."
    contradictions = _contradiction_dicts(db, user, query_text, supporting)
    stale_assumptions = _stale_assumption_dicts(db, user, query_text, supporting)
    recommended_next_actions = _next_actions_from_support(supporting, contradictions, stale_assumptions)
    graph_evidence = _merge_evidence(_evidence_from_memories(db, _primary_graph_evidence(supporting)), [])
    fallback_evidence: list[EvidenceReference] = []
    supporting_evidence = _merge_evidence(graph_evidence, fallback_evidence)
    return {
        "answer_text": answer_text,
        "why_this_answer": why_this_answer,
        "supporting_nodes": [_memory_reference(memory) for memory in supporting],
        "supporting_evidence": supporting_evidence,
        "contradictions": contradictions,
        "stale_assumptions": stale_assumptions,
        "recommended_next_actions": recommended_next_actions,
        "uncertainty_notes": _compose_uncertainty(supporting_evidence, bool(fallback_evidence), False),
    }


def _contradiction_result(db: Session, user: User, query_text: str) -> dict:
    contradiction_items = _contradiction_dicts(db, user, query_text, _load_memory_records(db, user))
    supporting = _memories_for_contradictions(db, user, contradiction_items)
    if contradiction_items:
        top = contradiction_items[0]
        answer_text = f"The clearest contradiction is between {top['from_title']} and {top['to_title']}."
        why_this_answer = "Contradiction analysis ranked explicit conflict pairs by memory-type importance, shared topic, timeline direction, and direct graph evidence before using query overlap as a tie-breaker."
    else:
        answer_text = "No explicit contradiction pair was found in the currently permitted scope for this topic."
        why_this_answer = "Contradiction analysis only returns explicit conflict pairs with evidence on both sides; none matched strongly enough."
    graph_evidence = _merge_evidence(_evidence_from_memories(db, _primary_graph_evidence(supporting)), [])
    fallback_evidence = [] if graph_evidence else _fts_evidence(db, user, query_text)
    supporting_evidence = _merge_evidence(graph_evidence, fallback_evidence)
    return {
        "answer_text": answer_text,
        "why_this_answer": why_this_answer,
        "supporting_nodes": [_memory_reference(memory) for memory in supporting],
        "supporting_evidence": supporting_evidence,
        "contradictions": contradiction_items,
        "stale_assumptions": [],
        "recommended_next_actions": _next_actions_from_support(supporting, contradiction_items, []),
        "uncertainty_notes": _compose_uncertainty(supporting_evidence, bool(fallback_evidence), not contradiction_items),
    }


def _assumption_drift_result(db: Session, user: User, query_text: str) -> dict:
    stale_assumptions = _stale_assumption_dicts(db, user, query_text, _load_memory_records(db, user))
    supporting = _memories_for_assumptions(db, user, stale_assumptions)
    if stale_assumptions:
        top = stale_assumptions[0]
        answer_text = f"The strongest drift signal is {top['title_or_label']} with status {top['status']}."
        why_this_answer = "Assumption drift prioritizes assumptions with persisted status changes, then narrows the explanation to later graph-linked signals on the same topic."
    else:
        answer_text = "No stale-assumption signal was found for the requested topic in the currently permitted scope."
        why_this_answer = "Assumption drift only surfaces assumptions whose status changed based on later evidence; none matched strongly enough."
    graph_evidence = _merge_evidence(_evidence_from_memories(db, _primary_graph_evidence(supporting)), [])
    fallback_evidence = [] if graph_evidence else _fts_evidence(db, user, query_text)
    supporting_evidence = _merge_evidence(graph_evidence, fallback_evidence)
    return {
        "answer_text": answer_text,
        "why_this_answer": why_this_answer,
        "supporting_nodes": [_memory_reference(memory) for memory in supporting],
        "supporting_evidence": supporting_evidence,
        "contradictions": _contradiction_dicts(db, user, query_text, supporting),
        "stale_assumptions": stale_assumptions,
        "recommended_next_actions": _next_actions_from_support(supporting, [], stale_assumptions),
        "uncertainty_notes": _compose_uncertainty(supporting_evidence, bool(fallback_evidence), not stale_assumptions),
    }


def _next_action_result(db: Session, user: User, query_text: str) -> dict:
    memories = _load_memory_records(db, user)
    contradiction_items = _contradiction_dicts(db, user, query_text, memories)
    stale_assumptions = _stale_assumption_dicts(db, user, query_text, memories)
    focus_text = " ".join(
        [
            query_text,
            *(f"{item['from_title']} {item['to_title']}" for item in contradiction_items[:2]),
            *(item["title_or_label"] for item in stale_assumptions[:2]),
        ]
    )
    open_commitments = _rank_open_commitments([memory for memory in memories if memory.memory_type == "commitment"], focus_text=focus_text)
    supporting = _dedupe_memories(
        _memories_for_contradictions(db, user, contradiction_items)[:4]
        + _memories_for_assumptions(db, user, stale_assumptions)[:4]
        + open_commitments[:4]
    )[:12]
    recommended_next_actions = _next_actions_from_support(supporting, contradiction_items, stale_assumptions)
    if recommended_next_actions:
        answer_text = recommended_next_actions[0]
    else:
        answer_text = "No high-confidence next action could be derived from the currently permitted contradictions, stale assumptions, and open commitments."
    why_this_answer = "Next-action guidance starts from the highest-ranked contradiction or drift signal on the same topic and only then promotes directly connected open commitments into recommendations."
    graph_evidence = _merge_evidence(_evidence_from_memories(db, _primary_graph_evidence(supporting)), [])
    fallback_evidence = [] if graph_evidence else _fts_evidence(db, user, query_text)
    supporting_evidence = _merge_evidence(graph_evidence, fallback_evidence)
    return {
        "answer_text": answer_text,
        "why_this_answer": why_this_answer,
        "supporting_nodes": [_memory_reference(memory) for memory in supporting],
        "supporting_evidence": supporting_evidence,
        "contradictions": contradiction_items,
        "stale_assumptions": stale_assumptions,
        "recommended_next_actions": recommended_next_actions,
        "uncertainty_notes": _compose_uncertainty(supporting_evidence, bool(fallback_evidence), not recommended_next_actions),
    }


def _dedupe_memories(memories: list[MemoryRecord]) -> list[MemoryRecord]:
    seen: set[tuple[str, str]] = set()
    deduped: list[MemoryRecord] = []
    for memory in memories:
        key = (memory.memory_type, memory.memory_id)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(memory)
    return deduped


def _node_id_for_memory(db: Session, user: User, memory: MemoryRecord) -> str:
    node = db.scalar(
        select(GraphNode).where(
            GraphNode.workspace_id == user.workspace_id,
            GraphNode.node_type == memory.memory_type,
            GraphNode.entity_id == memory.memory_id,
        )
    )
    return node.node_id if node is not None else ""


def _edge_pair_weight(from_type: str, to_type: str) -> int:
    pair = {from_type, to_type}
    if pair == {"decision"}:
        return 5
    if pair == {"decision", "commitment"}:
        return 4
    if pair == {"decision", "outcome"}:
        return 3
    if pair == {"commitment", "outcome"}:
        return 3
    if pair == {"decision", "constraint"}:
        return 2
    if pair == {"decision", "assumption"}:
        return 1
    return 0


def _ranking_basis(from_type: str, to_type: str, topic_key: str, chronology_bonus: int, evidence_chunk_id: str | None) -> list[str]:
    basis: list[str] = []
    pair_weight = _edge_pair_weight(from_type, to_type)
    if pair_weight >= 4:
        basis.append("decision/commitment priority")
    elif pair_weight >= 3:
        basis.append("roadmap reversal signal")
    elif pair_weight > 0:
        basis.append("topic-linked contradiction")
    if topic_key != "general":
        basis.append(f"topic:{topic_key}")
    if chronology_bonus:
        basis.append("later-over-earlier timeline")
    basis.append("graph evidence" if evidence_chunk_id else "graph link")
    return basis


def _contradiction_dicts(db: Session, user: User, query_text: str, memories: list[MemoryRecord], limit: int = 6) -> list[dict]:
    nodes = _load_nodes_by_id(db, user)
    memory_by_id = {memory.memory_id: memory for memory in _load_memory_records(db, user)}
    trusted_artifact_ids = _trusted_visible_artifact_ids(db, user)
    artifact_titles = _artifact_title_map(db, trusted_artifact_ids)
    artifact_review_statuses = _artifact_review_status_map(db, trusted_artifact_ids)
    ranked: list[dict] = []
    query_terms = _query_terms(query_text)
    for edge in _visible_edges(db, user):
        if edge.edge_type != "CONTRADICTS":
            continue
        from_node = nodes.get(edge.from_node_id)
        to_node = nodes.get(edge.to_node_id)
        if from_node is None or to_node is None:
            continue
        from_memory = memory_by_id.get(from_node.entity_id)
        to_memory = memory_by_id.get(to_node.entity_id)
        if from_memory is None or to_memory is None:
            continue
        if not _is_contradiction_comparable_pair(from_memory, to_memory):
            continue
        if from_memory.topic_key == "general" and to_memory.topic_key == "general":
            continue
        if from_memory.topic_key != to_memory.topic_key and _text_overlap(from_memory.topic_key, to_memory.topic_key) == 0:
            continue
        relevance = _text_overlap(f"{from_node.title_or_label} {to_node.title_or_label}", query_text)
        if relevance == 0 and query_text.strip():
            continue
        type_bonus = _edge_pair_weight(from_node.node_type, to_node.node_type)
        if "decision" in query_terms and "decision" in {from_node.node_type, to_node.node_type}:
            type_bonus += 2
        if "commitment" in query_terms and "commitment" in {from_node.node_type, to_node.node_type}:
            type_bonus += 2
        if "roadmap" in query_terms and {from_node.node_type, to_node.node_type} & {"decision", "commitment"}:
            type_bonus += 2
        chronology_bonus = 1 if from_memory.event_timestamp >= to_memory.event_timestamp else 0
        direct_evidence_bonus = 1 if edge.evidence_chunk_id else 0
        family_key = _contradiction_family_key(from_memory)
        topic_key = family_key if family_key != "general" else (from_memory.topic_key if from_memory.topic_key == to_memory.topic_key else from_memory.topic_key)
        evidence_span = _evidence_excerpt(
            db,
            chunk_id=edge.evidence_chunk_id,
            fallback=edge.evidence_span or f"{from_node.title_or_label} contradicts {to_node.title_or_label}",
        )
        evidence_provenance, uncertainty_note = _contradiction_provenance(
            artifact_title=_artifact_title_for_id(artifact_titles, edge.evidence_artifact_id),
            chunk_id=edge.evidence_chunk_id,
            from_title=from_node.title_or_label,
            to_title=to_node.title_or_label,
        )
        ranked.append(
            {
                "edge_id": edge.edge_id,
                "from_node_id": edge.from_node_id,
                "to_node_id": edge.to_node_id,
                "from_type": from_node.node_type,
                "to_type": to_node.node_type,
                "from_title": from_node.title_or_label,
                "to_title": to_node.title_or_label,
                "from_source_artifact_id": from_memory.source_artifact_id,
                "to_source_artifact_id": to_memory.source_artifact_id,
                "relation_label": "Contradicts",
                "confidence_score": edge.confidence_score,
                "evidence_artifact_id": edge.evidence_artifact_id,
                "evidence_artifact_review_status": _artifact_review_status_for_id(artifact_review_statuses, edge.evidence_artifact_id),
                "evidence_chunk_id": edge.evidence_chunk_id,
                "evidence_span": evidence_span,
                "evidence_provenance": evidence_provenance,
                "from_evidence": _contradiction_side_evidence(
                    db,
                    memory=from_memory,
                    artifact_titles=artifact_titles,
                    artifact_review_statuses=artifact_review_statuses,
                    time_label="later",
                ),
                "to_evidence": _contradiction_side_evidence(
                    db,
                    memory=to_memory,
                    artifact_titles=artifact_titles,
                    artifact_review_statuses=artifact_review_statuses,
                    time_label="earlier",
                ),
                "topic_key": topic_key,
                "claim_family_key": family_key,
                "relevance": relevance,
                "type_bonus": type_bonus,
                "chronology_bonus": chronology_bonus,
                "direct_evidence_bonus": direct_evidence_bonus,
                "ranking_basis": _ranking_basis(from_node.node_type, to_node.node_type, topic_key, chronology_bonus, edge.evidence_chunk_id),
                "uncertainty_note": uncertainty_note,
            }
        )
    ranked.sort(
        key=lambda item: (
            item["type_bonus"],
            item["chronology_bonus"],
            item["direct_evidence_bonus"],
            item["relevance"],
            item["confidence_score"],
        ),
        reverse=True,
    )
    return ranked[:limit]


def _stale_assumption_dicts(db: Session, user: User, query_text: str, memories: list[MemoryRecord], limit: int = 6) -> list[dict]:
    trusted_artifact_ids = _trusted_visible_artifact_ids(db, user)
    memory_by_id = {memory.memory_id: memory for memory in memories}
    artifact_titles = _artifact_title_map(db, trusted_artifact_ids)
    artifact_review_statuses = _artifact_review_status_map(db, trusted_artifact_ids)
    assumptions = db.scalars(select(Assumption).where(Assumption.workspace_id == user.workspace_id).order_by(Assumption.event_timestamp.desc())).all()
    items: list[dict] = []
    for row in assumptions:
        if row.source_artifact_id not in trusted_artifact_ids or row.status not in {"stale", "reversed", "weakening"}:
            continue
        relevance = _text_overlap(f"{row.title_or_label} {row.normalized_text}", query_text)
        if relevance == 0 and query_text.strip():
            continue
        assumption_memory = memory_by_id.get(row.assumption_id)
        supporting_signal = None
        if assumption_memory is not None:
            related = [memory for memory in _related_memories_for_node(db, user, _node_id_for_memory(db, user, assumption_memory)) if memory.memory_id != row.assumption_id]
            if related:
                related.sort(key=lambda memory: _drift_signal_sort_key(memory, assumption=row, query_text=query_text), reverse=True)
                supporting_signal = related[0]
        evidence_span = _evidence_excerpt(
            db,
            chunk_id=supporting_signal.source_chunk_id if supporting_signal is not None else row.source_chunk_id,
            fallback=(supporting_signal.evidence_span if supporting_signal is not None else None) or row.evidence_span or row.normalized_text,
        )
        evidence_provenance, uncertainty_note = _drift_provenance(
            artifact_title=_artifact_title_for_id(
                artifact_titles,
                supporting_signal.source_artifact_id if supporting_signal is not None else row.source_artifact_id,
            ),
            chunk_id=supporting_signal.source_chunk_id if supporting_signal is not None else row.source_chunk_id,
            assumption_title=row.title_or_label,
            signal_title=supporting_signal.title_or_label if supporting_signal is not None else None,
        )
        items.append(
            {
                "assumption_id": row.assumption_id,
                "title_or_label": row.title_or_label,
                "status": row.status,
                "validity_notes": row.validity_notes,
                "source_artifact_id": row.source_artifact_id,
                "source_artifact_review_status": _artifact_review_status_for_id(artifact_review_statuses, row.source_artifact_id),
                "confidence_score": row.confidence_score,
                "topic_key": row.topic_key,
                "supporting_signal_source_artifact_id": supporting_signal.source_artifact_id if supporting_signal is not None else None,
                "supporting_signal_artifact_review_status": (
                    _artifact_review_status_for_id(artifact_review_statuses, supporting_signal.source_artifact_id)
                    if supporting_signal is not None
                    else None
                ),
                "supporting_signal_title": supporting_signal.title_or_label if supporting_signal is not None else None,
                "supporting_signal_type": supporting_signal.memory_type if supporting_signal is not None else None,
                "supporting_signal_memory_id": supporting_signal.memory_id if supporting_signal is not None else None,
                "evidence_span": evidence_span,
                "evidence_provenance": evidence_provenance,
                "ranking_basis": [
                    f"status:{row.status}",
                    f"topic:{row.topic_key}",
                    "later evidence linked" if supporting_signal is not None else "status persisted without linked signal",
                ],
                "uncertainty_note": uncertainty_note,
                "relevance": relevance,
            }
        )
    items.sort(key=lambda item: (item["relevance"], item["confidence_score"]), reverse=True)
    return items[:limit]


def _memories_for_contradictions(db: Session, user: User, contradiction_items: list[dict]) -> list[MemoryRecord]:
    nodes = _load_nodes_by_id(db, user)
    memory_by_id = {memory.memory_id: memory for memory in _load_memory_records(db, user)}
    supporting: list[MemoryRecord] = []
    if contradiction_items:
        primary_family = contradiction_items[0].get("claim_family_key")
        filtered_items = [
            item for item in contradiction_items[:4]
            if not primary_family or item.get("claim_family_key") == primary_family
        ] or contradiction_items[:2]
    else:
        filtered_items = contradiction_items
    for item in filtered_items:
        for node_id in (item["from_node_id"], item["to_node_id"]):
            node = nodes.get(node_id)
            if node is None:
                continue
            memory = memory_by_id.get(node.entity_id)
            if memory is not None:
                supporting.append(memory)
    return _dedupe_memories(supporting)


def _memories_for_assumptions(db: Session, user: User, stale_assumptions: list[dict]) -> list[MemoryRecord]:
    memories = _load_memory_records(db, user)
    memory_by_id = {memory.memory_id: memory for memory in memories}
    supporting: list[MemoryRecord] = []
    for item in stale_assumptions:
        memory = memory_by_id.get(item["assumption_id"])
        if memory is not None:
            supporting.append(memory)
            supporting.extend(_related_memories_for_node(db, user, _node_id_for_memory(db, user, memory)))
    return _dedupe_memories(supporting)


def _merge_evidence(primary: list[EvidenceReference], secondary: list[EvidenceReference]) -> list[EvidenceReference]:
    evidence: list[EvidenceReference] = []
    seen: set[tuple[str, str | None]] = set()
    for item in primary + secondary:
        key = (item.artifact_id, item.chunk_id)
        if key in seen:
            continue
        seen.add(key)
        evidence.append(item)
    return evidence[:8]


def _primary_graph_evidence(memories: list[MemoryRecord], limit: int = 6) -> list[MemoryRecord]:
    return [memory for memory in memories if memory.source_chunk_id][:limit]


def _compose_uncertainty(evidence: list[EvidenceReference], used_fallback: bool, insufficient_basis: bool) -> list[str]:
    notes: list[str] = []
    if insufficient_basis:
        notes.append("The result is based on limited corroborating evidence in the current visible scope.")
    if used_fallback:
        notes.append("Some support came from text search fallback rather than direct graph-linked evidence.")
    if not evidence:
        notes.append("No directly quoted evidence excerpt could be surfaced from the current visible artifacts.")
    return notes


DECISION_COMMITMENT_TERMS = {
    "decide",
    "decides",
    "decision",
    "whether",
    "keep",
    "revert",
    "approve",
    "approval",
    "review",
    "launch",
    "roadmap",
}


def _commitment_decision_relevance(commitment: MemoryRecord) -> int:
    text = f"{commitment.title_or_label} {commitment.normalized_text}".lower()
    return sum(1 for term in DECISION_COMMITMENT_TERMS if term in text)


def _rank_open_commitments(commitments: list[MemoryRecord], *, focus_text: str = "") -> list[MemoryRecord]:
    now = datetime.utcnow()
    return sorted(
        [commitment for commitment in commitments if commitment.status != "closed"],
        key=lambda commitment: (
            _text_overlap(f"{commitment.title_or_label} {commitment.normalized_text}", focus_text),
            _commitment_decision_relevance(commitment),
            1 if commitment.due_date and commitment.due_date <= now else 0,
            commitment.event_timestamp,
            commitment.confidence_score,
            commitment.due_date or datetime.min,
        ),
        reverse=True,
    )


def _commitment_action_text(commitment: MemoryRecord) -> str:
    owner_text = f" for {commitment.owner_label}" if commitment.owner_label else ""
    if commitment.due_date:
        if commitment.due_date < datetime.utcnow():
            return (
                f"Review the open commitment{owner_text} overdue since {commitment.due_date.strftime('%Y-%m-%d')}: "
                f"'{commitment.title_or_label}'."
            )
        return f"Review the open commitment{owner_text} due on {commitment.due_date.strftime('%Y-%m-%d')}: '{commitment.title_or_label}'."
    return f"Review the open commitment '{commitment.title_or_label}' and confirm whether its due path is still realistic."


def _next_actions_from_support(memories: list[MemoryRecord], contradictions: list[dict], stale_assumptions: list[dict]) -> list[str]:
    actions: list[str] = []
    if contradictions:
        top = contradictions[0]
        actions.append(f"Resolve the conflict between {top['from_title']} and {top['to_title']} before committing to the current roadmap path.")
    if stale_assumptions:
        top = stale_assumptions[0]
        actions.append(f"Revalidate the assumption '{top['title_or_label']}' because later evidence now marks it {top['status']}.")
    focus_text = " ".join(
        [
            *(f"{item['from_title']} {item['to_title']}" for item in contradictions[:2]),
            *(item["title_or_label"] for item in stale_assumptions[:2]),
        ]
    )
    open_commitments = _rank_open_commitments([memory for memory in memories if memory.memory_type == "commitment"], focus_text=focus_text)
    if open_commitments:
        actions.append(_commitment_action_text(open_commitments[0]))
    return actions[:3]


def _signal_memory_payload(memories: list[MemoryRecord]) -> list[dict[str, Any]]:
    return [_memory_reference(memory).model_dump(mode="json") for memory in _dedupe_memories(memories)[:8]]


def _signal_evidence_payload(db: Session, memories: list[MemoryRecord]) -> list[dict[str, Any]]:
    evidence = _merge_evidence(_evidence_from_memories(db, _primary_graph_evidence(_dedupe_memories(memories))), [])
    return [item.model_dump(mode="json") for item in evidence[:6]]


def _memory_overlap_score(left: MemoryRecord, right: MemoryRecord) -> tuple[float, list[str]]:
    left_text = f"{left.topic_key} {left.title_or_label} {left.normalized_text}"
    right_text = f"{right.topic_key} {right.title_or_label} {right.normalized_text}"
    overlap = _text_overlap(left_text, right_text)
    basis: list[str] = []
    score = float(overlap)
    if overlap >= 2:
        basis.append(f"shared terms:{overlap}")
    if left.topic_key != "general" and left.topic_key == right.topic_key:
        score += 4.0
        basis.append(f"same topic:{left.topic_key}")
    elif left.topic_key != "general" and right.topic_key != "general" and _text_overlap(left.topic_key, right.topic_key) >= 1:
        score += 2.0
        basis.append("related topic")
    if left.memory_type == right.memory_type:
        score += 1.5
        basis.append(f"same memory type:{left.memory_type}")
    if left.memory_type in {"decision", "outcome", "commitment"} or right.memory_type in {"decision", "outcome", "commitment"}:
        score += 0.5
        basis.append("decision/outcome/commitment continuity")
    return score, basis


def _prior_relevant_work_items(db: Session, user: User, artifact: Artifact, memories: list[MemoryRecord], *, limit: int = 6) -> list[dict[str, Any]]:
    introduced = [memory for memory in memories if memory.source_artifact_id == artifact.artifact_id]
    prior = [memory for memory in memories if memory.source_artifact_id != artifact.artifact_id]
    if not introduced or not prior:
        return []

    grouped: dict[str, dict[str, Any]] = {}
    for new_memory in introduced:
        for prior_memory in prior:
            pair_score, pair_basis = _memory_overlap_score(new_memory, prior_memory)
            if pair_score < 4.0:
                continue
            bucket = grouped.setdefault(
                prior_memory.source_artifact_id,
                {
                    "score": 0.0,
                    "basis": set(),
                    "introduced": [],
                    "prior": [],
                    "topics": {},
                },
            )
            bucket["score"] += pair_score
            bucket["basis"].update(pair_basis)
            bucket["introduced"].append(new_memory)
            bucket["prior"].append(prior_memory)
            topic_key = prior_memory.topic_key if prior_memory.topic_key != "general" else new_memory.topic_key
            if topic_key:
                bucket["topics"][topic_key] = bucket["topics"].get(topic_key, 0) + 1

    if not grouped:
        return []

    artifact_titles = _artifact_title_map(db, set(grouped) | {artifact.artifact_id})
    artifact_review_statuses = _artifact_review_status_map(db, set(grouped) | {artifact.artifact_id})
    items: list[dict[str, Any]] = []
    for prior_artifact_id, bucket in grouped.items():
        introduced_support = _dedupe_memories(bucket["introduced"])[:4]
        prior_support = _dedupe_memories(bucket["prior"])[:4]
        if not introduced_support or not prior_support:
            continue
        related_topic = max(bucket["topics"].items(), key=lambda item: item[1])[0] if bucket["topics"] else "general"
        prior_artifact_title = _artifact_title_for_id(artifact_titles, prior_artifact_id)
        new_titles = ", ".join(memory.title_or_label for memory in introduced_support[:2])
        prior_titles = ", ".join(memory.title_or_label for memory in prior_support[:2])
        overlap_score = round(min(0.98, bucket["score"] / 18), 2)
        items.append(
            {
                "prior_artifact_id": prior_artifact_id,
                "prior_artifact_title": prior_artifact_title,
                "prior_artifact_review_status": _artifact_review_status_for_id(artifact_review_statuses, prior_artifact_id),
                "related_topic": related_topic or "general",
                "overlap_score": overlap_score,
                "continuity_reason": (
                    f"This artifact overlaps with prior work in {prior_artifact_title}: new memory '{new_titles}' "
                    f"matches earlier memory '{prior_titles}'."
                ),
                "recommended_action": (
                    f"Review '{prior_artifact_title}' before repeating the analysis; reuse or explicitly update the prior memory "
                    f"on {related_topic or 'this topic'}."
                ),
                "introduced_memory_objects": _signal_memory_payload(introduced_support),
                "prior_memory_objects": _signal_memory_payload(prior_support),
                "supporting_memory_objects": _signal_memory_payload(introduced_support + prior_support),
                "supporting_evidence": _signal_evidence_payload(db, introduced_support + prior_support),
                "ranking_basis": sorted(bucket["basis"])[:8],
            }
        )

    items.sort(key=lambda item: (item["overlap_score"], len(item["prior_memory_objects"]), item["prior_artifact_title"]), reverse=True)
    return items[:limit]


def _signal_uncertainty(memories: list[MemoryRecord], fallback_confidence: float = 0.55) -> float:
    confidence_values = [memory.confidence_score for memory in memories] or [fallback_confidence]
    average_confidence = sum(confidence_values) / len(confidence_values)
    return round(max(0.05, min(0.95, 1 - average_confidence)), 2)


def _related_commitment_support(memories: list[MemoryRecord], focus_text: str) -> list[MemoryRecord]:
    commitments = [memory for memory in memories if memory.memory_type == "commitment"]
    return _rank_open_commitments(commitments, focus_text=focus_text)[:1]


def _next_action_signal_payload(
    db: Session,
    *,
    signal_id: str,
    title: str,
    summary: str,
    related_topic: str,
    urgency_score: float,
    recommended_action: str,
    grounded_reasoning: str,
    supporting_memories: list[MemoryRecord],
    source_signal_types: list[str],
    ranking_basis: list[str],
) -> dict[str, Any]:
    support = _dedupe_memories(supporting_memories)
    return {
        "signal_id": signal_id,
        "signal_type": "next_action",
        "title": title,
        "summary": summary,
        "related_topic": related_topic or "general",
        "urgency_score": round(urgency_score, 2),
        "uncertainty_score": _signal_uncertainty(support),
        "grounded_reasoning": grounded_reasoning,
        "recommended_action": recommended_action,
        "supporting_memory_objects": _signal_memory_payload(support),
        "supporting_evidence": _signal_evidence_payload(db, support),
        "source_signal_types": source_signal_types,
        "ranking_basis": ranking_basis,
    }


_CLAIM_TITLE_REPLACEMENTS: tuple[tuple[str, str], ...] = (
    (
        "we decided to keep the self-serve launch decision gate open until security and activation instrumentation evidence can be compared",
        "launch gate stays open",
    ),
    (
        "move the self-serve onboarding launch target to Q3 2026 and prioritize foundation work first",
        "move launch to Q3 2026",
    ),
)


def _compact_signal_claim_title(value: str, *, max_length: int = 72) -> str:
    compacted = " ".join(value.split())
    lowered = compacted.lower()
    for source, replacement in _CLAIM_TITLE_REPLACEMENTS:
        if lowered == source:
            return replacement
        compacted = compacted.replace(source, replacement).replace(source.capitalize(), replacement)

    if len(compacted) <= max_length:
        return compacted
    return f"{compacted[: max_length - 1].rstrip()}…"


def _contradiction_next_action_title(item: dict[str, Any]) -> str:
    from_title = _compact_signal_claim_title(str(item.get("from_title") or "new claim"))
    to_title = _compact_signal_claim_title(str(item.get("to_title") or "prior claim"))
    if from_title == "launch gate stays open" and to_title == "move launch to Q3 2026":
        return "Resolve launch timing: gate open ↔ Q3 2026"
    if from_title == "move launch to Q3 2026" and to_title == "launch gate stays open":
        return "Resolve launch timing: Q3 2026 ↔ gate open"
    return f"Resolve contradiction: {from_title} ↔ {to_title}"


def _contradiction_next_action_signal(
    db: Session,
    user: User,
    *,
    item: dict[str, Any],
    memories: list[MemoryRecord],
) -> dict[str, Any] | None:
    focus_text = f"{item['from_title']} {item['to_title']} {item.get('topic_key', '')}"
    supporting = _dedupe_memories(_memories_for_contradictions(db, user, [item]) + _related_commitment_support(memories, focus_text))
    actions = _next_actions_from_support(supporting, [item], [])
    if not actions:
        return None
    has_commitment = any(memory.memory_type == "commitment" for memory in supporting)
    return _next_action_signal_payload(
        db,
        signal_id=_stable_signal_id("sig_next", "contradiction", str(item.get("edge_id"))),
        title=_contradiction_next_action_title(item),
        summary="A later roadmap claim now collides with an earlier decision or commitment in the reconstructed memory graph.",
        related_topic=str(item.get("topic_key") or item.get("claim_family_key") or "general"),
        urgency_score=0.92 if has_commitment else 0.84,
        recommended_action=actions[0],
        grounded_reasoning=(
            f"The graph contains a CONTRADICTS edge between the later claim '{item['from_title']}' and the earlier record "
            f"'{item['to_title']}'. The paired evidence spans identify both sides before recommending a resolution step."
        ),
        supporting_memories=supporting,
        source_signal_types=["contradiction"] + (["open_commitment"] if has_commitment else []),
        ranking_basis=["active contradiction", *item.get("ranking_basis", []), "evidence-backed recommendation"],
    )


def _drift_next_action_signal(
    db: Session,
    user: User,
    *,
    item: dict[str, Any],
    memories: list[MemoryRecord],
) -> dict[str, Any] | None:
    focus_text = f"{item['title_or_label']} {item.get('supporting_signal_title') or ''} {item.get('topic_key', '')}"
    supporting = _dedupe_memories(_memories_for_assumptions(db, user, [item]) + _related_commitment_support(memories, focus_text))
    actions = _next_actions_from_support(supporting, [], [item])
    if not actions:
        return None
    has_commitment = any(memory.memory_type == "commitment" for memory in supporting)
    return _next_action_signal_payload(
        db,
        signal_id=_stable_signal_id("sig_next", "drift", str(item.get("assumption_id")), str(item.get("supporting_signal_memory_id"))),
        title=f"Revalidate drifted assumption: {item['title_or_label']}",
        summary="A previously active assumption is now marked stale, weakening, or reversed by later evidence.",
        related_topic=str(item.get("topic_key") or "general"),
        urgency_score=0.86 if item.get("status") == "reversed" else 0.78,
        recommended_action=actions[0],
        grounded_reasoning=(
            f"The assumption '{item['title_or_label']}' is currently {item.get('status')} and is linked to later evidence "
            f"'{item.get('supporting_signal_title') or 'in the graph'}', so the next action is to revalidate the operating basis."
        ),
        supporting_memories=supporting,
        source_signal_types=["assumption_drift"] + (["open_commitment"] if has_commitment else []),
        ranking_basis=["active assumption drift", *item.get("ranking_basis", []), "evidence-backed recommendation"],
    )


def _commitment_next_action_signal(db: Session, *, commitment: MemoryRecord) -> dict[str, Any]:
    overdue = bool(commitment.due_date and commitment.due_date < datetime.utcnow())
    return _next_action_signal_payload(
        db,
        signal_id=_stable_signal_id("sig_next", "commitment", commitment.memory_id),
        title=f"Review open commitment: {commitment.title_or_label}",
        summary="An open commitment remains in the reconstructed memory and should be checked before the team moves.",
        related_topic=commitment.topic_key,
        urgency_score=0.74 if overdue else 0.62,
        recommended_action=_commitment_action_text(commitment),
        grounded_reasoning=(
            "The commitment is still open in the memory graph"
            + (f" and its due date was {commitment.due_date.strftime('%Y-%m-%d')}." if commitment.due_date else ".")
        ),
        supporting_memories=[commitment],
        source_signal_types=["open_commitment"],
        ranking_basis=["open commitment", "evidence-backed recommendation"] + (["overdue"] if overdue else []),
    )


def _supersession_dicts_for_artifact(db: Session, user: User, artifact_id: str, limit: int = 6) -> list[dict[str, Any]]:
    nodes = _load_nodes_by_id(db, user)
    memory_by_id = {memory.memory_id: memory for memory in _load_memory_records(db, user)}
    trusted_artifact_ids = _trusted_visible_artifact_ids(db, user)
    artifact_titles = _artifact_title_map(db, trusted_artifact_ids)
    artifact_review_statuses = _artifact_review_status_map(db, trusted_artifact_ids)
    items: list[dict[str, Any]] = []

    for edge in _visible_edges(db, user):
        if edge.edge_type != "SUPERSEDES" or edge.evidence_artifact_id != artifact_id:
            continue
        from_node = nodes.get(edge.from_node_id)
        to_node = nodes.get(edge.to_node_id)
        if from_node is None or to_node is None:
            continue
        from_memory = memory_by_id.get(from_node.entity_id)
        to_memory = memory_by_id.get(to_node.entity_id)
        if from_memory is None or to_memory is None:
            continue
        topic_key = from_memory.topic_key if from_memory.topic_key != "general" else to_memory.topic_key
        evidence_artifact_title = _artifact_title_for_id(artifact_titles, edge.evidence_artifact_id)
        items.append(
            {
                "edge_id": edge.edge_id,
                "from_node_id": edge.from_node_id,
                "to_node_id": edge.to_node_id,
                "from_type": from_node.node_type,
                "to_type": to_node.node_type,
                "from_title": from_node.title_or_label,
                "to_title": to_node.title_or_label,
                "from_source_artifact_id": from_memory.source_artifact_id,
                "to_source_artifact_id": to_memory.source_artifact_id,
                "relation_label": "Supersedes",
                "confidence_score": edge.confidence_score,
                "evidence_artifact_id": edge.evidence_artifact_id,
                "evidence_artifact_title": evidence_artifact_title,
                "evidence_artifact_review_status": _artifact_review_status_for_id(artifact_review_statuses, edge.evidence_artifact_id),
                "evidence_chunk_id": edge.evidence_chunk_id,
                "evidence_span": _evidence_excerpt(
                    db,
                    chunk_id=edge.evidence_chunk_id,
                    fallback=edge.evidence_span or f"{from_node.title_or_label} supersedes {to_node.title_or_label}",
                ),
                "evidence_provenance": (
                    f"Supersession/reopening edge recorded in {evidence_artifact_title}, linking the later claim "
                    f"'{from_node.title_or_label}' to earlier memory '{to_node.title_or_label}'."
                ),
                "topic_key": topic_key,
                "ranking_basis": ["supersession/reopening", f"topic:{topic_key}", "later-over-earlier timeline", "graph evidence"],
            }
        )

    items.sort(key=lambda item: (item["confidence_score"], item["from_title"]), reverse=True)
    return items[:limit]


def _signal_supports_artifact(signal: dict[str, Any], artifact_id: str) -> bool:
    supporting_evidence = [item for item in signal.get("supporting_evidence", []) if isinstance(item, dict)]
    supporting_memory = [item for item in signal.get("supporting_memory_objects", []) if isinstance(item, dict)]
    return any(item.get("artifact_id") == artifact_id for item in supporting_evidence) or any(
        item.get("source_artifact_id") == artifact_id for item in supporting_memory
    )


def artifact_proactive_signals(db: Session, user: User, artifact: Artifact, *, include_persisted: bool = True) -> dict[str, Any]:
    if artifact.review_status == "rejected":
        signal_counts = {
            "contradictions": 0,
            "assumption_drift": 0,
            "supersessions": 0,
            "prior_relevant_work": 0,
            "next_actions": 0,
        }
        return {
            "artifact_id": artifact.artifact_id,
            "artifact_title": artifact.title,
            "ingestion_status": artifact.ingestion_status,
            "summary": "This artifact is marked rejected by admin review, so it is excluded from trusted proactive intelligence.",
            "signal_counts": signal_counts,
            "introduced_contradictions": [],
            "revealed_assumption_drift": [],
            "superseded_memory": [],
            "prior_relevant_work": [],
            "recommended_next_actions": [],
            "persisted_signals": [],
        }
    memories = _load_memory_records(db, user)
    contradiction_items = [
        item
        for item in _contradiction_dicts(db, user, "", memories, limit=24)
        if item.get("evidence_artifact_id") == artifact.artifact_id or item.get("from_source_artifact_id") == artifact.artifact_id
    ]
    drift_items = [
        item
        for item in _stale_assumption_dicts(db, user, "", memories, limit=24)
        if item.get("supporting_signal_source_artifact_id") == artifact.artifact_id
    ]
    supersession_items = _supersession_dicts_for_artifact(db, user, artifact.artifact_id, limit=8)
    prior_relevant_work = _prior_relevant_work_items(db, user, artifact, memories, limit=6)
    next_actions = [
        signal
        for signal in list_ranked_next_actions(db, user, limit=24)
        if _signal_supports_artifact(signal, artifact.artifact_id)
    ][:8]
    signal_counts = {
        "contradictions": len(contradiction_items),
        "assumption_drift": len(drift_items),
        "supersessions": len(supersession_items),
        "prior_relevant_work": len(prior_relevant_work),
        "next_actions": len(next_actions),
    }
    total_signal_count = sum(signal_counts.values())
    if artifact.ingestion_status != "completed":
        summary = "This artifact has not completed ingestion, so proactive memory effects are not available yet."
    elif total_signal_count:
        summary = (
            f"This artifact produced {signal_counts['contradictions']} contradiction signal(s), "
            f"{signal_counts['assumption_drift']} assumption-drift signal(s), "
            f"{signal_counts['supersessions']} supersession/reopening link(s), and "
            f"{signal_counts['prior_relevant_work']} prior-work continuity signal(s), plus "
            f"{signal_counts['next_actions']} grounded next-action recommendation(s)."
        )
    else:
        summary = "No contradiction, drift, supersession, continuity, or next-action signal could be grounded from this artifact in the current visible memory."
    return {
        "artifact_id": artifact.artifact_id,
        "artifact_title": artifact.title,
        "ingestion_status": artifact.ingestion_status,
        "summary": summary,
        "signal_counts": signal_counts,
        "introduced_contradictions": contradiction_items,
        "revealed_assumption_drift": drift_items,
        "superseded_memory": supersession_items,
        "prior_relevant_work": prior_relevant_work,
        "recommended_next_actions": next_actions,
        "persisted_signals": _persisted_signals_for_artifact(db, user, artifact.artifact_id) if include_persisted else [],
    }


def _persist_signal_row(
    db: Session,
    *,
    signal_id: str,
    workspace_id: str,
    source_artifact_id: str,
    signal_type: str,
    title: str,
    summary: str,
    related_topic: str,
    urgency_score: float,
    uncertainty_score: float,
    grounded_reasoning: str,
    recommended_action: str | None,
    payload_json: dict[str, Any],
) -> None:
    settings = get_settings()
    payload_to_store = dict(payload_json)
    payload_to_store["reasoning_boundary"] = {
        "signal_detection": "deterministic_graph_analysis",
        "signal_persistence": "deterministic_backend",
        "llm_role": "disabled" if not settings.llm_signal_explanation_enabled else "explain_existing_signal_only",
    }

    if settings.llm_signal_explanation_enabled:
        try:
            llm_explanation = explain_signal_with_local_llm(
                signal_type=signal_type,
                title=title,
                summary=summary,
                related_topic=related_topic,
                grounded_reasoning=grounded_reasoning,
                recommended_action=recommended_action,
                payload_json=payload_json,
            )
            summary = llm_explanation.summary
            grounded_reasoning = llm_explanation.grounded_reasoning
            recommended_action = llm_explanation.recommended_action
            payload_to_store["llm_signal_explanation"] = {
                "status": "applied",
                "model": settings.local_llm_model,
                "gateway": settings.local_llm_base_url,
                "role": "wording_and_guidance_only",
                "confidence_rationale": llm_explanation.confidence_rationale,
                "cited_artifact_ids": llm_explanation.cited_artifact_ids,
                "cited_memory_ids": llm_explanation.cited_memory_ids,
                "risk_notes": llm_explanation.risk_notes,
            }
        except Exception as exc:
            payload_to_store["llm_signal_explanation"] = {
                "status": "fallback",
                "model": settings.local_llm_model,
                "gateway": settings.local_llm_base_url,
                "role": "wording_and_guidance_only",
                "fallback_reason": str(exc),
            }

    db.add(
        Signal(
            signal_id=signal_id,
            workspace_id=workspace_id,
            source_artifact_id=source_artifact_id,
            signal_type=signal_type,
            title=title[:255],
            summary=summary,
            related_topic=related_topic or "general",
            urgency_score=round(urgency_score, 2),
            uncertainty_score=round(max(0.05, min(0.95, uncertainty_score)), 2),
            grounded_reasoning=grounded_reasoning,
            recommended_action=recommended_action,
            payload_json=payload_to_store,
            status="active",
        )
    )


def persist_artifact_proactive_signals(db: Session, user: User, artifact: Artifact) -> dict[str, Any]:
    payload = artifact_proactive_signals(db, user, artifact, include_persisted=False)
    db.execute(delete(Signal).where(Signal.workspace_id == artifact.workspace_id, Signal.source_artifact_id == artifact.artifact_id))

    for item in payload["introduced_contradictions"]:
        confidence_score = float(item.get("confidence_score", 0.55))
        _persist_signal_row(
            db,
            signal_id=_stable_signal_id("sig_con", artifact.artifact_id, str(item.get("edge_id"))),
            workspace_id=artifact.workspace_id,
            source_artifact_id=artifact.artifact_id,
            signal_type="contradiction",
            title=f"Contradiction: {item['from_title']} ↔ {item['to_title']}",
            summary="A newly ingested artifact introduced a contradiction against prior memory.",
            related_topic=str(item.get("topic_key") or "general"),
            urgency_score=0.9,
            uncertainty_score=1 - confidence_score,
            grounded_reasoning=str(item.get("evidence_provenance") or item.get("evidence_span") or "Graph contradiction edge with linked evidence."),
            recommended_action=None,
            payload_json=item,
        )

    for item in payload["revealed_assumption_drift"]:
        confidence_score = float(item.get("confidence_score", 0.55))
        status = str(item.get("status") or "stale")
        _persist_signal_row(
            db,
            signal_id=_stable_signal_id("sig_drift", artifact.artifact_id, str(item.get("assumption_id")), str(item.get("supporting_signal_memory_id"))),
            workspace_id=artifact.workspace_id,
            source_artifact_id=artifact.artifact_id,
            signal_type="assumption_drift",
            title=f"Assumption drift: {item['title_or_label']}",
            summary=f"A newly ingested artifact marked this assumption {status}.",
            related_topic=str(item.get("topic_key") or "general"),
            urgency_score=0.84 if status == "reversed" else 0.76,
            uncertainty_score=1 - confidence_score,
            grounded_reasoning=str(item.get("evidence_provenance") or item.get("validity_notes") or "Later evidence changed the assumption status."),
            recommended_action=None,
            payload_json=item,
        )

    for item in payload["superseded_memory"]:
        confidence_score = float(item.get("confidence_score", 0.55))
        _persist_signal_row(
            db,
            signal_id=_stable_signal_id("sig_super", artifact.artifact_id, str(item.get("edge_id"))),
            workspace_id=artifact.workspace_id,
            source_artifact_id=artifact.artifact_id,
            signal_type="supersession",
            title=f"Supersession: {item['from_title']} supersedes {item['to_title']}",
            summary="A newly ingested artifact reopened or superseded earlier memory.",
            related_topic=str(item.get("topic_key") or "general"),
            urgency_score=0.72,
            uncertainty_score=1 - confidence_score,
            grounded_reasoning=str(item.get("evidence_provenance") or item.get("evidence_span") or "Graph supersession edge with linked evidence."),
            recommended_action=None,
            payload_json=item,
        )

    for item in payload["prior_relevant_work"]:
        overlap_score = float(item.get("overlap_score", 0.55))
        _persist_signal_row(
            db,
            signal_id=_stable_signal_id("sig_continuity", artifact.artifact_id, str(item.get("prior_artifact_id")), str(item.get("related_topic"))),
            workspace_id=artifact.workspace_id,
            source_artifact_id=artifact.artifact_id,
            signal_type="continuity_overlap",
            title=f"Prior relevant work: {item['prior_artifact_title']}",
            summary="A newly ingested artifact substantially overlaps with prior organizational work.",
            related_topic=str(item.get("related_topic") or "general"),
            urgency_score=0.64,
            uncertainty_score=1 - overlap_score,
            grounded_reasoning=str(item.get("continuity_reason") or "Prior related memory objects overlap with this artifact."),
            recommended_action=str(item.get("recommended_action") or ""),
            payload_json=item,
        )

    for item in payload["recommended_next_actions"]:
        _persist_signal_row(
            db,
            signal_id=_stable_signal_id("sig_action", artifact.artifact_id, str(item.get("signal_id")), str(item.get("recommended_action"))),
            workspace_id=artifact.workspace_id,
            source_artifact_id=artifact.artifact_id,
            signal_type="next_action",
            title=str(item["title"]),
            summary=str(item.get("summary") or "Grounded next action derived from newly changed memory."),
            related_topic=str(item.get("related_topic") or "general"),
            urgency_score=float(item.get("urgency_score", 0.6)),
            uncertainty_score=float(item.get("uncertainty_score", 0.4)),
            grounded_reasoning=str(item.get("grounded_reasoning") or "Next action was derived from artifact-scoped memory signals."),
            recommended_action=str(item.get("recommended_action") or ""),
            payload_json=item,
        )

    db.flush()
    return payload


def _signal_read_model(signal: Signal, artifact_titles: dict[str, str]) -> SignalRead:
    return SignalRead(
        signal_id=signal.signal_id,
        workspace_id=signal.workspace_id,
        source_artifact_id=signal.source_artifact_id,
        source_artifact_title=_artifact_title_for_id(artifact_titles, signal.source_artifact_id) if signal.source_artifact_id else None,
        signal_type=signal.signal_type,
        title=signal.title,
        summary=signal.summary,
        related_topic=signal.related_topic,
        urgency_score=signal.urgency_score,
        uncertainty_score=signal.uncertainty_score,
        grounded_reasoning=signal.grounded_reasoning,
        recommended_action=signal.recommended_action,
        status=signal.status,
        created_at=signal.created_at,
        updated_at=signal.updated_at,
    )


def _signal_visible_rows(db: Session, user: User, *, limit: int = 50) -> list[Signal]:
    trusted_artifact_ids = _trusted_visible_artifact_ids(db, user)
    if not trusted_artifact_ids:
        return []
    return list(
        db.scalars(
            select(Signal)
            .where(
                Signal.workspace_id == user.workspace_id,
                Signal.status == "active",
                Signal.source_artifact_id.in_(trusted_artifact_ids),
            )
            .order_by(Signal.urgency_score.desc(), Signal.created_at.desc())
            .limit(limit)
        ).all()
    )


def list_persisted_signals(db: Session, user: User, *, limit: int = 50) -> list[SignalRead]:
    signals = _signal_visible_rows(db, user, limit=limit)
    artifact_titles = _artifact_title_map(db, {signal.source_artifact_id for signal in signals if signal.source_artifact_id})
    return [_signal_read_model(signal, artifact_titles) for signal in signals]


def _persisted_signals_for_artifact(db: Session, user: User, artifact_id: str, *, limit: int = 12) -> list[SignalRead]:
    if artifact_id not in _trusted_visible_artifact_ids(db, user):
        return []
    signals = db.scalars(
        select(Signal)
        .where(
            Signal.workspace_id == user.workspace_id,
            Signal.status == "active",
            Signal.source_artifact_id == artifact_id,
        )
        .order_by(Signal.urgency_score.desc(), Signal.created_at.desc())
        .limit(limit)
    ).all()
    artifact_titles = _artifact_title_map(db, {artifact_id})
    return [_signal_read_model(signal, artifact_titles) for signal in signals]


def _value_from_item(item: Any, key: str) -> Any:
    if isinstance(item, dict):
        return item.get(key)
    return getattr(item, key, None)


def _query_payload_artifact_ids(payload: dict[str, Any], visible_artifact_ids: set[str]) -> set[str]:
    artifact_ids: set[str] = set()

    for node in payload.get("supporting_nodes", []):
        artifact_id = _value_from_item(node, "source_artifact_id")
        if isinstance(artifact_id, str) and artifact_id in visible_artifact_ids:
            artifact_ids.add(artifact_id)

    for evidence in payload.get("supporting_evidence", []):
        artifact_id = _value_from_item(evidence, "artifact_id")
        if isinstance(artifact_id, str) and artifact_id in visible_artifact_ids:
            artifact_ids.add(artifact_id)

    for contradiction in [item for item in payload.get("contradictions", []) if isinstance(item, dict)]:
        for key in ("evidence_artifact_id", "from_source_artifact_id", "to_source_artifact_id"):
            artifact_id = contradiction.get(key)
            if isinstance(artifact_id, str) and artifact_id in visible_artifact_ids:
                artifact_ids.add(artifact_id)

    for stale_assumption in [item for item in payload.get("stale_assumptions", []) if isinstance(item, dict)]:
        for key in ("source_artifact_id", "supporting_signal_source_artifact_id"):
            artifact_id = stale_assumption.get(key)
            if isinstance(artifact_id, str) and artifact_id in visible_artifact_ids:
                artifact_ids.add(artifact_id)

    return artifact_ids


def related_signals_for_query_payload(db: Session, user: User, payload: dict[str, Any], *, limit: int = 6) -> list[SignalRead]:
    trusted_artifact_ids = _trusted_visible_artifact_ids(db, user)
    artifact_ids = _query_payload_artifact_ids(payload, trusted_artifact_ids)
    if not artifact_ids:
        return []
    signals = db.scalars(
        select(Signal)
        .where(
            Signal.workspace_id == user.workspace_id,
            Signal.status == "active",
            Signal.source_artifact_id.in_(artifact_ids),
        )
        .order_by(Signal.urgency_score.desc(), Signal.created_at.desc())
        .limit(limit)
    ).all()
    artifact_titles = _artifact_title_map(db, {signal.source_artifact_id for signal in signals if signal.source_artifact_id})
    return [_signal_read_model(signal, artifact_titles) for signal in signals]


def _dedupe_memory_references(references: list[MemoryReference]) -> list[MemoryReference]:
    seen: set[tuple[str, str]] = set()
    deduped: list[MemoryReference] = []
    for reference in references:
        key = (reference.memory_type, reference.memory_id)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(reference)
    return deduped


def _dedupe_evidence_references(references: list[EvidenceReference]) -> list[EvidenceReference]:
    seen: set[tuple[str, str | None, str]] = set()
    deduped: list[EvidenceReference] = []
    for reference in references:
        key = (reference.artifact_id, reference.chunk_id, reference.excerpt)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(reference)
    return deduped


def _memory_reference_from_payload(
    item: dict[str, Any],
    visible_artifact_ids: set[str],
    artifact_review_statuses: dict[str, str],
) -> MemoryReference | None:
    if item.get("source_artifact_id") not in visible_artifact_ids:
        return None
    try:
        reference = MemoryReference.model_validate(item)
        return reference.model_copy(
            update={
                "source_artifact_review_status": _artifact_review_status_for_id(
                    artifact_review_statuses,
                    reference.source_artifact_id,
                )
            }
        )
    except Exception:
        return None


def _evidence_reference_from_payload(
    item: dict[str, Any],
    visible_artifact_ids: set[str],
    artifact_review_statuses: dict[str, str],
) -> EvidenceReference | None:
    if item.get("artifact_id") not in visible_artifact_ids:
        return None
    try:
        reference = EvidenceReference.model_validate(item)
        return reference.model_copy(
            update={"artifact_review_status": _artifact_review_status_for_id(artifact_review_statuses, reference.artifact_id)}
        )
    except Exception:
        return None


def _evidence_reference_from_side_evidence(
    item: dict[str, Any],
    visible_artifact_ids: set[str],
    artifact_review_statuses: dict[str, str],
) -> EvidenceReference | None:
    artifact_id = item.get("artifact_id")
    if not isinstance(artifact_id, str) or artifact_id not in visible_artifact_ids:
        return None
    artifact_title = item.get("artifact_title")
    excerpt = item.get("excerpt")
    return EvidenceReference(
        artifact_id=artifact_id,
        artifact_title=str(artifact_title or artifact_id),
        artifact_review_status=_artifact_review_status_for_id(artifact_review_statuses, artifact_id),
        chunk_id=item.get("chunk_id") if isinstance(item.get("chunk_id"), str) else None,
        excerpt=str(excerpt or ""),
        evidence_kind="graph",
    )


SIGNAL_PAYLOAD_ARTIFACT_KEYS = {
    "artifact_id",
    "source_artifact_id",
    "evidence_artifact_id",
    "from_source_artifact_id",
    "to_source_artifact_id",
    "supporting_signal_source_artifact_id",
    "prior_artifact_id",
}


def _filter_signal_payload_for_reader(value: Any, visible_artifact_ids: set[str], key_hint: str = "") -> Any:
    if isinstance(value, dict):
        for key, nested in value.items():
            if key in SIGNAL_PAYLOAD_ARTIFACT_KEYS and isinstance(nested, str) and nested not in visible_artifact_ids:
                return None
        filtered: dict[str, Any] = {}
        for key, nested in value.items():
            if key.endswith("artifact_ids") and isinstance(nested, list):
                filtered[key] = [item for item in nested if isinstance(item, str) and item in visible_artifact_ids]
                continue
            nested_value = _filter_signal_payload_for_reader(nested, visible_artifact_ids, key)
            if nested_value is not None:
                filtered[key] = nested_value
        return filtered
    if isinstance(value, list):
        filtered_items = [_filter_signal_payload_for_reader(item, visible_artifact_ids, key_hint) for item in value]
        return [item for item in filtered_items if item is not None]
    if key_hint in SIGNAL_PAYLOAD_ARTIFACT_KEYS and isinstance(value, str) and value not in visible_artifact_ids:
        return None
    return value


def _memory_for_node_id(node_id: str | None, nodes: dict[str, NodeRecord], memories_by_id: dict[str, MemoryRecord]) -> MemoryRecord | None:
    if node_id is None:
        return None
    node = nodes.get(node_id)
    if node is None:
        return None
    return memories_by_id.get(node.entity_id)


def _memory_refs_for_signal_payload(
    db: Session,
    user: User,
    payload: dict[str, Any],
    visible_artifact_ids: set[str],
) -> list[MemoryReference]:
    references: list[MemoryReference] = []
    artifact_review_statuses = _artifact_review_status_map(db, visible_artifact_ids)

    if isinstance(payload.get("supporting_memory_objects"), list):
        for item in payload["supporting_memory_objects"]:
            if not isinstance(item, dict):
                continue
            reference = _memory_reference_from_payload(item, visible_artifact_ids, artifact_review_statuses)
            if reference is not None:
                references.append(reference)

    memories = _load_memory_records(db, user)
    memories_by_id = {memory.memory_id: memory for memory in memories}
    nodes = _load_nodes_by_id(db, user)

    for node_key in ("from_node_id", "to_node_id"):
        memory = _memory_for_node_id(payload.get(node_key) if isinstance(payload.get(node_key), str) else None, nodes, memories_by_id)
        if memory is not None:
            references.append(_memory_reference(memory))

    for memory_key in ("assumption_id", "supporting_signal_memory_id"):
        memory_id = payload.get(memory_key)
        memory = memories_by_id.get(memory_id) if isinstance(memory_id, str) else None
        if memory is not None:
            references.append(_memory_reference(memory))

    return _dedupe_memory_references(references)[:8]


def _evidence_refs_for_signal_payload(
    db: Session,
    payload: dict[str, Any],
    visible_artifact_ids: set[str],
    artifact_titles: dict[str, str],
) -> list[EvidenceReference]:
    references: list[EvidenceReference] = []
    artifact_review_statuses = _artifact_review_status_map(db, visible_artifact_ids)

    if isinstance(payload.get("supporting_evidence"), list):
        for item in payload["supporting_evidence"]:
            if not isinstance(item, dict):
                continue
            reference = _evidence_reference_from_payload(item, visible_artifact_ids, artifact_review_statuses)
            if reference is not None:
                references.append(reference)

    for side_key in ("from_evidence", "to_evidence"):
        side_payload = payload.get(side_key)
        if isinstance(side_payload, dict):
            reference = _evidence_reference_from_side_evidence(side_payload, visible_artifact_ids, artifact_review_statuses)
            if reference is not None:
                references.append(reference)

    direct_artifact_id = payload.get("evidence_artifact_id")
    if isinstance(direct_artifact_id, str) and direct_artifact_id in visible_artifact_ids:
        evidence_chunk_id = payload.get("evidence_chunk_id") if isinstance(payload.get("evidence_chunk_id"), str) else None
        evidence_span = payload.get("evidence_span")
        references.append(
            EvidenceReference(
                artifact_id=direct_artifact_id,
                artifact_title=_artifact_title_for_id(artifact_titles, direct_artifact_id),
                artifact_review_status=_artifact_review_status_for_id(artifact_review_statuses, direct_artifact_id),
                chunk_id=evidence_chunk_id,
                excerpt=_evidence_excerpt(
                    db,
                    chunk_id=evidence_chunk_id,
                    fallback=str(evidence_span or payload.get("evidence_provenance") or ""),
                ),
                evidence_kind="graph",
            )
        )

    for artifact_key in ("source_artifact_id", "supporting_signal_source_artifact_id"):
        artifact_id = payload.get(artifact_key)
        if not isinstance(artifact_id, str) or artifact_id not in visible_artifact_ids:
            continue
        evidence_span = payload.get("evidence_span") or payload.get("validity_notes") or payload.get("evidence_provenance")
        references.append(
            EvidenceReference(
                artifact_id=artifact_id,
                artifact_title=_artifact_title_for_id(artifact_titles, artifact_id),
                artifact_review_status=_artifact_review_status_for_id(artifact_review_statuses, artifact_id),
                chunk_id=None,
                excerpt=str(evidence_span or "Visible source artifact contributed to this persisted signal."),
                evidence_kind="graph",
            )
        )

    return _dedupe_evidence_references([reference for reference in references if reference.excerpt])[:8]


def _signal_type_label(signal_type: str) -> str:
    labels = {
        "contradiction": "contradiction",
        "assumption_drift": "assumption drift",
        "supersession": "supersession",
        "continuity_overlap": "prior-work continuity",
        "next_action": "next-action guidance",
    }
    return labels.get(signal_type, signal_type.replace("_", " "))


def _signal_intelligence_path(
    signal: Signal,
    *,
    supporting_memory_objects: list[MemoryReference],
    supporting_evidence: list[EvidenceReference],
) -> list[SignalIntelligenceStep]:
    source_step_evidence = [item for item in supporting_evidence if item.artifact_id == signal.source_artifact_id][:2]
    source_description = (
        "A visible artifact entered the workspace memory boundary. Extraction may use the central company-controlled "
        "LLM adapter when configured, with deterministic heuristic fallback preserving local-first operation."
    )
    graph_description = (
        "The backend normalized extracted claims into structured memory objects and graph edges, then filtered support "
        "through the reader's artifact permissions and artifact review status. Rejected artifacts are not used as trusted support."
    )
    classification_description = (
        f"Deterministic graph analysis classified the persisted object as {_signal_type_label(signal.signal_type)} on topic "
        f"{signal.related_topic}; urgency and uncertainty are stored with the signal instead of recomputed in the browser."
    )
    payload = signal.payload_json if isinstance(signal.payload_json, dict) else {}
    llm_metadata_value = payload.get("llm_signal_explanation")
    llm_metadata = llm_metadata_value if isinstance(llm_metadata_value, dict) else {}
    if llm_metadata.get("status") == "applied":
        guidance_description = (
            "A central company-controlled local LLM assisted only the wording of the persisted explanation and action; "
            "the signal type, source evidence, urgency, and persistence boundary remained deterministic. "
            f"{signal.recommended_action or 'No automatic task was promoted.'}"
        )
    elif llm_metadata.get("status") == "fallback":
        guidance_description = (
            "LLM-assisted wording was attempted but the backend kept the deterministic explanation because the local "
            "inference gateway failed or returned invalid structure. "
            f"{signal.recommended_action or 'No automatic task was promoted.'}"
        )
    else:
        guidance_description = (
            signal.recommended_action
            or "No automatic task was promoted; the signal remains inspectable so an operator can resolve the memory tension before acting."
        )
    return [
        SignalIntelligenceStep(
            step_kind="source_artifact",
            title="Source artifact entered memory",
            description=source_description,
            supporting_evidence=source_step_evidence,
            supporting_memory_objects=[],
        ),
        SignalIntelligenceStep(
            step_kind="memory_reconstruction",
            title="Structured memory was reconstructed",
            description=graph_description,
            supporting_evidence=supporting_evidence[:3],
            supporting_memory_objects=supporting_memory_objects[:4],
        ),
        SignalIntelligenceStep(
            step_kind="signal_classification",
            title="Signal was classified and persisted",
            description=classification_description,
            supporting_evidence=supporting_evidence[:3],
            supporting_memory_objects=supporting_memory_objects[:4],
        ),
        SignalIntelligenceStep(
            step_kind="guidance_composition",
            title="Guidance boundary was made explicit",
            description=guidance_description,
            supporting_evidence=supporting_evidence[:2],
            supporting_memory_objects=supporting_memory_objects[:3],
        ),
    ]


def get_persisted_signal_detail(db: Session, user: User, signal_id: str) -> SignalDetail | None:
    signal = db.scalar(select(Signal).where(Signal.signal_id == signal_id, Signal.workspace_id == user.workspace_id))
    if signal is None:
        return None

    trusted_artifact_ids = _trusted_visible_artifact_ids(db, user)
    if signal.source_artifact_id not in trusted_artifact_ids:
        return None

    artifact_titles = _artifact_title_map(db, {artifact_id for artifact_id in trusted_artifact_ids if artifact_id})
    raw_payload = signal.payload_json if isinstance(signal.payload_json, dict) else {}
    payload = _filter_signal_payload_for_reader(raw_payload, trusted_artifact_ids)
    if not isinstance(payload, dict):
        payload = {}
    supporting_memory_objects = _memory_refs_for_signal_payload(db, user, payload, trusted_artifact_ids)
    supporting_evidence = _evidence_refs_for_signal_payload(db, payload, trusted_artifact_ids, artifact_titles)
    intelligence_path = _signal_intelligence_path(
        signal,
        supporting_memory_objects=supporting_memory_objects,
        supporting_evidence=supporting_evidence,
    )
    return SignalDetail(
        **_signal_read_model(signal, artifact_titles).model_dump(),
        payload_json=payload,
        supporting_memory_objects=supporting_memory_objects,
        supporting_evidence=supporting_evidence,
        intelligence_path=intelligence_path,
    )


def _persist_query_trace_steps(
    db: Session,
    *,
    query_run: QueryRun,
    route_decision: QueryRouteDecision,
    result_data: dict[str, Any],
    permissions_limited: bool,
    hidden_artifact_count: int,
    rejected_artifact_count: int,
    context_assembly_ms: int,
) -> None:
    supporting_nodes = result_data.get("supporting_nodes", [])
    supporting_evidence = result_data.get("supporting_evidence", [])
    contradictions = result_data.get("contradictions", [])
    stale_assumptions = result_data.get("stale_assumptions", [])
    recommended_next_actions = result_data.get("recommended_next_actions", [])
    uncertainty_notes = result_data.get("uncertainty_notes", [])

    graph_evidence_count = sum(1 for item in supporting_evidence if item.evidence_kind == "graph")
    search_fallback_count = sum(1 for item in supporting_evidence if item.evidence_kind != "graph")
    context_packet = build_context_packet(
        packet_id=f"{query_run.query_run_id}:context",
        query_class=query_run.query_class,
        supporting_nodes=supporting_nodes,
        supporting_evidence=supporting_evidence,
        permissions_limited=permissions_limited,
        hidden_artifact_count=hidden_artifact_count,
        rejected_artifact_count=rejected_artifact_count,
        context_assembly_ms=context_assembly_ms,
    )
    verifier_result = build_provenance_verifier_result(
        context_packet=context_packet,
        uncertainty_notes=uncertainty_notes,
    )

    bounded_orchestration_payload = build_bounded_orchestration_payload(
        query_class=query_run.query_class,
        context_packet=context_packet,
        verifier_result=verifier_result,
        contradiction_count=len(contradictions),
        drift_count=len(stale_assumptions),
        guidance_count=len(recommended_next_actions),
    )
    stage_packet_execution_payload = run_bounded_parallel_stage_packets(
        query_class=query_run.query_class,
        context_packet=context_packet,
        verifier_result=verifier_result,
        contradiction_count=len(contradictions),
        drift_count=len(stale_assumptions),
        guidance_count=len(recommended_next_actions),
    )
    context_packet_payload = context_packet.to_payload()
    verifier_payload = verifier_result.to_payload()
    stage_packets_by_key = {
        str(packet.get("stage_key")): packet
        for packet in stage_packet_execution_payload.get("packets", [])
        if isinstance(packet, dict)
    }
    trace_payloads: list[tuple[str, dict[str, Any]]] = [
        (
            "route_decision",
            _route_decision_trace_payload(route_decision),
        ),
        (
            "bounded_orchestration",
            bounded_orchestration_payload,
        ),
        (
            "stage_packet_execution",
            stage_packet_execution_payload,
        ),
        (
            "seed_selection",
            {
                "supporting_nodes": _memory_trace_payload_items(supporting_nodes),
                "contradiction_pairs": _contradiction_trace_payload_items(contradictions),
                "stale_assumptions": _drift_trace_payload_items(stale_assumptions),
            },
        ),
        (
            "context_assembly",
            context_packet_payload,
        ),
        (
            "provenance_verification",
            verifier_payload,
        ),
        (
            "evidence_selection",
            {
                "supporting_evidence": _evidence_trace_payload_items(supporting_evidence),
                "selected_evidence_count": len(supporting_evidence),
                "graph_evidence_count": graph_evidence_count,
                "search_fallback_count": search_fallback_count,
            },
        ),
        (
            "answer_composition",
            {
                "direct_answer": result_data["answer_text"],
                "why_this_answer": result_data["why_this_answer"],
                "answer_synthesis": result_data.get("answer_synthesis"),
                "section_counts": {
                    "supporting_nodes": len(supporting_nodes),
                    "supporting_evidence": len(supporting_evidence),
                    "contradictions": len(contradictions),
                    "assumption_drift": len(stale_assumptions),
                    "recommended_next_actions": len(result_data.get("recommended_next_actions", [])),
                },
            },
        ),
        (
            "uncertainty_note",
            {
                "notes": uncertainty_notes,
                "permissions_limited": permissions_limited,
                "hidden_artifact_count": hidden_artifact_count,
                "rejected_artifact_count": rejected_artifact_count,
            },
        ),
    ]

    for step_kind, payload in trace_payloads:
        db.add(
            QueryTraceStep(
                query_run_id=query_run.query_run_id,
                workspace_id=query_run.workspace_id,
                step_kind=step_kind,
                payload_json=payload,
            )
        )

    for stage in bounded_orchestration_payload.get("stages", []):
        if not isinstance(stage, dict):
            continue
        stage_key = str(stage.get("stage_key") or "unknown_stage")
        stage_packet = stage_packets_by_key.get(stage_key)
        stage_packet_id = str(stage_packet.get("stage_packet_id")) if stage_packet else None
        db.add(
            OrchestrationStageRun(
                query_run_id=query_run.query_run_id,
                workspace_id=query_run.workspace_id,
                stage_key=stage_key,
                status=str(stage.get("status") or "unknown"),
                authority_level=str(stage.get("authority_level") or "unspecified"),
                verifier_status=verifier_result.status,
                input_refs={
                    "context_packet_id": context_packet.packet_id,
                    "query_class": query_run.query_class,
                    "schema_version": "orchestration_stage_run_input.v1",
                    "stage_packet_id": stage_packet_id,
                    "stage_packet_schema_version": stage_packet.get("schema_version") if stage_packet else None,
                    "execution_wave": stage_packet.get("execution_wave") if stage_packet else None,
                },
                output_summary={
                    "schema_version": "orchestration_stage_run_output.v1",
                    "output_count": int(stage.get("output_count") or 0),
                    "reason": str(stage.get("reason") or ""),
                    "verifier_status": verifier_result.status,
                    "verifier_checks": verifier_payload.get("checks", {}),
                    "trusted_write_allowed": False,
                    "execution_model": stage_packet.get("execution_model") if stage_packet else "deterministic_stage",
                    "stage_packet": stage_packet,
                },
            )
        )


def _filter_trace_payload(payload: dict[str, Any], visible_artifact_ids: set[str]) -> dict[str, Any]:
    filtered = dict(payload)
    omitted_count = 0

    if isinstance(filtered.get("supporting_nodes"), list):
        original = [item for item in filtered["supporting_nodes"] if isinstance(item, dict)]
        kept = [item for item in original if item.get("source_artifact_id") in visible_artifact_ids]
        omitted_count += len(original) - len(kept)
        filtered["supporting_nodes"] = kept

    if isinstance(filtered.get("contradiction_pairs"), list):
        original = [item for item in filtered["contradiction_pairs"] if isinstance(item, dict)]
        kept = [
            item
            for item in original
            if _payload_item_visible(item, ["from_source_artifact_id", "to_source_artifact_id"], visible_artifact_ids)
        ]
        omitted_count += len(original) - len(kept)
        filtered["contradiction_pairs"] = kept

    if isinstance(filtered.get("stale_assumptions"), list):
        original = [item for item in filtered["stale_assumptions"] if isinstance(item, dict)]
        kept = [
            item
            for item in original
            if _payload_item_visible(item, ["source_artifact_id", "supporting_signal_source_artifact_id"], visible_artifact_ids)
        ]
        omitted_count += len(original) - len(kept)
        filtered["stale_assumptions"] = kept

    if isinstance(filtered.get("supporting_evidence"), list):
        original = [item for item in filtered["supporting_evidence"] if isinstance(item, dict)]
        kept = [item for item in original if item.get("artifact_id") in visible_artifact_ids]
        omitted_count += len(original) - len(kept)
        filtered["supporting_evidence"] = kept

    if isinstance(filtered.get("selected_memory"), list):
        original = [item for item in filtered["selected_memory"] if isinstance(item, dict)]
        kept = [item for item in original if item.get("source_artifact_id") in visible_artifact_ids]
        omitted_count += len(original) - len(kept)
        filtered["selected_memory"] = kept
        if isinstance(filtered.get("evidence_budget"), dict):
            filtered["evidence_budget"] = {
                **filtered["evidence_budget"],
                "selected_memory_count": len(kept),
                "packet_memory_count": len(kept),
            }
        if isinstance(filtered.get("metrics"), dict):
            filtered["metrics"] = {
                **filtered["metrics"],
                "selected_memory_count": len(kept),
                "packet_memory_count": len(kept),
            }

    if isinstance(filtered.get("selected_evidence"), list):
        original = [item for item in filtered["selected_evidence"] if isinstance(item, dict)]
        kept = [item for item in original if item.get("artifact_id") in visible_artifact_ids]
        omitted_count += len(original) - len(kept)
        filtered["selected_evidence"] = kept
        filtered["selected_evidence_ids"] = [item.get("chunk_id") or item.get("artifact_id") for item in kept]
        if isinstance(filtered.get("evidence_budget"), dict):
            filtered["evidence_budget"] = {
                **filtered["evidence_budget"],
                "selected_evidence_count": len(kept),
                "packet_evidence_count": len(kept),
                "within_budget": len(kept) <= int(filtered["evidence_budget"].get("max_selected_evidence", 12)),
            }
        if isinstance(filtered.get("metrics"), dict):
            filtered["metrics"] = {
                **filtered["metrics"],
                "selected_evidence_count": len(kept),
                "packet_evidence_count": len(kept),
            }

    if omitted_count:
        filtered["omitted_items"] = omitted_count
    metrics = filtered.get("metrics")
    if isinstance(metrics, dict) and "trace_payload_bytes" in metrics:
        filtered["metrics"] = {**metrics, "trace_payload_bytes": 0}
        filtered["metrics"]["trace_payload_bytes"] = stable_payload_size_bytes(filtered)
    return filtered


def list_ranked_contradictions(db: Session, user: User, limit: int = 12) -> list[dict]:
    return _contradiction_dicts(db, user, "", _load_memory_records(db, user), limit=limit)


def list_ranked_assumption_drift(db: Session, user: User, limit: int = 12) -> list[dict]:
    return _stale_assumption_dicts(db, user, "", _load_memory_records(db, user), limit=limit)


def list_ranked_next_actions(db: Session, user: User, limit: int = 12) -> list[dict]:
    memories = _load_memory_records(db, user)
    contradiction_items = _contradiction_dicts(db, user, "", memories, limit=limit)
    drift_items = _stale_assumption_dicts(db, user, "", memories, limit=limit)
    signals: list[dict[str, Any]] = []

    for item in contradiction_items[:4]:
        signal = _contradiction_next_action_signal(db, user, item=item, memories=memories)
        if signal is not None:
            signals.append(signal)

    for item in drift_items[:4]:
        signal = _drift_next_action_signal(db, user, item=item, memories=memories)
        if signal is not None:
            signals.append(signal)

    focus_text = " ".join(
        [
            *(f"{item['from_title']} {item['to_title']}" for item in contradiction_items[:3]),
            *(item["title_or_label"] for item in drift_items[:3]),
        ]
    )
    commitments = [memory for memory in memories if memory.memory_type == "commitment"]
    for commitment in _rank_open_commitments(commitments, focus_text=focus_text)[:4]:
        signals.append(_commitment_next_action_signal(db, commitment=commitment))

    deduped: list[dict[str, Any]] = []
    seen_actions: set[str] = set()
    for signal in signals:
        action = signal["recommended_action"]
        if action in seen_actions:
            continue
        seen_actions.add(action)
        deduped.append(signal)

    deduped.sort(
        key=lambda item: (
            item["urgency_score"],
            len(item["supporting_evidence"]),
            1 - item["uncertainty_score"],
            item["title"],
        ),
        reverse=True,
    )
    return deduped[:limit]


def execute_query(db: Session, *, query_text: str, actor: User, conversation_context: str | None = None) -> QueryRun:
    employee_question = " ".join(query_text.strip().split())
    chat_context = " ".join(conversation_context.strip().split()) if conversation_context else None
    route_decision = classify_query_with_trace(employee_question)
    query_class = route_decision.query_class
    all_workspace_artifacts = db.scalars(select(Artifact).where(Artifact.workspace_id == actor.workspace_id)).all()
    visible_artifacts = _visible_artifacts(db, actor)
    trusted_visible_artifacts = [artifact for artifact in visible_artifacts if artifact.review_status != "rejected"]
    permissions_limited = len(visible_artifacts) < len(all_workspace_artifacts)
    hidden_artifact_count = max(len(all_workspace_artifacts) - len(visible_artifacts), 0)
    rejected_artifact_count = max(len(visible_artifacts) - len(trusted_visible_artifacts), 0)

    context_assembly_started_at = perf_counter()
    if query_class == "Contradiction analysis":
        result_data = _contradiction_result(db, actor, employee_question)
    elif query_class == "Assumption drift":
        result_data = _assumption_drift_result(db, actor, employee_question)
    elif query_class == "Next-action guidance":
        result_data = _next_action_result(db, actor, employee_question)
    else:
        result_data = _lineage_result(db, actor, employee_question)
    if rejected_artifact_count and "Some visible evidence was excluded because an admin marked its source artifact rejected." not in result_data["uncertainty_notes"]:
        result_data["uncertainty_notes"].append("Some visible evidence was excluded because an admin marked its source artifact rejected.")
    context_assembly_ms = max(0, round((perf_counter() - context_assembly_started_at) * 1000))
    result_data = _apply_optional_llm_answer_synthesis(
        query_text=employee_question,
        query_class=query_class,
        result_data=result_data,
        conversation_context=chat_context,
    )

    query_run = QueryRun(
        workspace_id=actor.workspace_id,
        created_by=actor.user_id,
        query_text=employee_question,
        query_class=query_class,
        route_confidence=route_decision.route_confidence,
        status="completed",
        answer_text=result_data["answer_text"],
        answer_payload={},
        permissions_limited=permissions_limited,
    )
    db.add(query_run)
    db.commit()
    db.refresh(query_run)
    payload = QueryResult(
        query_run_id=query_run.query_run_id,
        query_text=query_text,
        query_class=query_class,
        status="completed",
        answer_text=result_data["answer_text"],
        why_this_answer=result_data["why_this_answer"],
        supporting_nodes=result_data["supporting_nodes"],
        supporting_evidence=result_data["supporting_evidence"],
        contradictions=result_data["contradictions"],
        stale_assumptions=result_data["stale_assumptions"],
        recommended_next_actions=result_data["recommended_next_actions"],
        related_signals=related_signals_for_query_payload(db, actor, result_data),
        uncertainty_notes=result_data["uncertainty_notes"],
        permissions_limited=permissions_limited,
        created_at=query_run.created_at,
    )
    query_run.answer_payload = payload.model_dump(mode="json")
    _persist_query_trace_steps(
        db,
        query_run=query_run,
        route_decision=route_decision,
        result_data=result_data,
        permissions_limited=permissions_limited,
        hidden_artifact_count=hidden_artifact_count,
        rejected_artifact_count=rejected_artifact_count,
        context_assembly_ms=context_assembly_ms,
    )
    db.commit()
    log_event(
        db,
        workspace_id=actor.workspace_id,
        actor_user_id=actor.user_id,
        event_type="QUERY_SUBMITTED",
        target_type="query_run",
        target_id=query_run.query_run_id,
        event_metadata={"query_class": query_class, "route_confidence": route_decision.route_confidence},
    )
    log_event(
        db,
        workspace_id=actor.workspace_id,
        actor_user_id=actor.user_id,
        event_type="QUERY_RESULT_GENERATED",
        target_type="query_run",
        target_id=query_run.query_run_id,
        event_metadata={"query_class": query_class, "supporting_nodes": len(result_data['supporting_nodes'])},
    )
    db.refresh(query_run)
    return query_run


def build_query_result_for_reader(db: Session, query_run: QueryRun, reader: User) -> QueryResult:
    payload = query_run.answer_payload
    visible_artifact_ids = _visible_artifact_ids(db, reader)
    trusted_artifact_ids = _trusted_visible_artifact_ids(db, reader)
    trusted_artifact_review_statuses = _artifact_review_status_map(db, trusted_artifact_ids)
    payload_supporting_nodes = [item for item in payload.get("supporting_nodes", []) if isinstance(item, dict)]
    payload_supporting_evidence = [item for item in payload.get("supporting_evidence", []) if isinstance(item, dict)]
    payload_contradictions = [item for item in payload.get("contradictions", []) if isinstance(item, dict)]
    payload_stale_assumptions = [item for item in payload.get("stale_assumptions", []) if isinstance(item, dict)]

    supporting_node_dicts = [item for item in payload_supporting_nodes if item.get("source_artifact_id") in trusted_artifact_ids]
    supporting_evidence_dicts = [item for item in payload_supporting_evidence if item.get("artifact_id") in trusted_artifact_ids]
    contradictions = [
        item
        for item in payload_contradictions
        if _payload_item_visible(item, ["evidence_artifact_id", "from_source_artifact_id", "to_source_artifact_id"], trusted_artifact_ids)
    ]
    stale_assumptions = [
        item
        for item in payload_stale_assumptions
        if _payload_item_visible(item, ["source_artifact_id", "supporting_signal_source_artifact_id"], trusted_artifact_ids)
    ]
    supporting_nodes = [
        MemoryReference.model_validate(item).model_copy(
            update={
                "source_artifact_review_status": _artifact_review_status_for_id(
                    trusted_artifact_review_statuses,
                    item.get("source_artifact_id") if isinstance(item.get("source_artifact_id"), str) else None,
                )
            }
        )
        for item in supporting_node_dicts
    ]
    supporting_evidence = [
        EvidenceReference.model_validate(item).model_copy(
            update={
                "artifact_review_status": _artifact_review_status_for_id(
                    trusted_artifact_review_statuses,
                    item.get("artifact_id") if isinstance(item.get("artifact_id"), str) else None,
                )
            }
        )
        for item in supporting_evidence_dicts
    ]
    permissions_limited = payload.get("permissions_limited", False) or len(visible_artifact_ids) < db.query(Artifact).filter(Artifact.workspace_id == reader.workspace_id).count()
    uncertainty_notes = list(payload.get("uncertainty_notes", []))
    answer_text = query_run.answer_text
    why_this_answer = payload.get("why_this_answer", "This answer was composed from the available memory objects and evidence references.")
    recommended_next_actions = payload.get("recommended_next_actions", [])

    redacted_payload = any(
        (
            len(supporting_nodes) != len(payload_supporting_nodes),
            len(supporting_evidence) != len(payload_supporting_evidence),
            len(contradictions) != len(payload_contradictions),
            len(stale_assumptions) != len(payload_stale_assumptions),
        )
    )
    if redacted_payload:
        answer_text, why_this_answer, recommended_next_actions = _redacted_query_text(
            query_class=query_run.query_class,
            contradictions=contradictions,
            stale_assumptions=stale_assumptions,
            supporting_nodes=supporting_node_dicts,
        )
    if permissions_limited and "Some relevant evidence may be unavailable due to artifact permissions." not in uncertainty_notes:
        uncertainty_notes.append("Some relevant evidence may be unavailable due to artifact permissions.")
    if len(trusted_artifact_ids) < len(visible_artifact_ids) and "Some visible evidence was excluded because an admin marked its source artifact rejected." not in uncertainty_notes:
        uncertainty_notes.append("Some visible evidence was excluded because an admin marked its source artifact rejected.")
    if redacted_payload and "This cached result was reduced to remove details from artifacts you can no longer access." not in uncertainty_notes:
        uncertainty_notes.append("This cached result was reduced to remove details from artifacts you can no longer access or that are no longer review-accepted.")
    return QueryResult(
        query_run_id=query_run.query_run_id,
        query_text=query_run.query_text,
        query_class=query_run.query_class,
        status=query_run.status,
        answer_text=answer_text,
        why_this_answer=why_this_answer,
        answer_type=payload.get("answer_type", "institutional_memory_response"),
        supporting_nodes=supporting_nodes,
        supporting_evidence=supporting_evidence,
        contradictions=contradictions,
        stale_assumptions=stale_assumptions,
        recommended_next_actions=recommended_next_actions,
        related_signals=related_signals_for_query_payload(
            db,
            reader,
            {
                "supporting_nodes": supporting_nodes,
                "supporting_evidence": supporting_evidence,
                "contradictions": contradictions,
                "stale_assumptions": stale_assumptions,
            },
        ),
        uncertainty_notes=uncertainty_notes,
        permissions_limited=permissions_limited,
        created_at=query_run.created_at,
    )


def build_query_trace_for_reader(db: Session, query_run: QueryRun, reader: User) -> QueryTraceRead:
    trusted_artifact_ids = _trusted_visible_artifact_ids(db, reader)
    trace_steps = db.scalars(
        select(QueryTraceStep)
        .where(QueryTraceStep.query_run_id == query_run.query_run_id, QueryTraceStep.workspace_id == reader.workspace_id)
        .order_by(QueryTraceStep.created_at.asc())
    ).all()
    steps = [
        QueryTraceStepRead(
            step_kind=step.step_kind,
            payload=_filter_trace_payload(step.payload_json, trusted_artifact_ids),
            created_at=step.created_at,
        )
        for step in trace_steps
    ]
    visible_artifact_ids = _visible_artifact_ids(db, reader)
    permissions_limited = query_run.permissions_limited or len(visible_artifact_ids) < db.query(Artifact).filter(Artifact.workspace_id == reader.workspace_id).count()
    return QueryTraceRead(
        query_run_id=query_run.query_run_id,
        query_class=query_run.query_class,
        route_confidence=query_run.route_confidence,
        permissions_limited=permissions_limited,
        steps=steps,
    )


def graph_summary(db: Session, user: User) -> tuple[dict[str, int], dict[str, int], int, dict[str, int]]:
    visible_artifact_ids = _review_priority_visible_artifact_ids(db, user)
    memory_counts = {
        "decisions": db.query(Decision).filter(Decision.workspace_id == user.workspace_id, Decision.source_artifact_id.in_(visible_artifact_ids)).count(),
        "assumptions": db.query(Assumption).filter(Assumption.workspace_id == user.workspace_id, Assumption.source_artifact_id.in_(visible_artifact_ids)).count(),
        "constraints": db.query(Constraint).filter(Constraint.workspace_id == user.workspace_id, Constraint.source_artifact_id.in_(visible_artifact_ids)).count(),
        "outcomes": db.query(Outcome).filter(Outcome.workspace_id == user.workspace_id, Outcome.source_artifact_id.in_(visible_artifact_ids)).count(),
        "commitments": db.query(Commitment).filter(Commitment.workspace_id == user.workspace_id, Commitment.source_artifact_id.in_(visible_artifact_ids)).count(),
    }
    rows = db.execute(
        select(GraphEdge.edge_type, func.count(GraphEdge.edge_id))
        .where(GraphEdge.workspace_id == user.workspace_id, GraphEdge.evidence_artifact_id.in_(visible_artifact_ids))
        .group_by(GraphEdge.edge_type)
    ).all()
    edge_counts = {edge_type: count for edge_type, count in rows}
    signal_rows = db.execute(
        select(Signal.signal_type, func.count(Signal.signal_id))
        .where(
            Signal.workspace_id == user.workspace_id,
            Signal.status == "active",
            Signal.source_artifact_id.in_(visible_artifact_ids),
        )
        .group_by(Signal.signal_type)
    ).all()
    signal_counts = {signal_type: count for signal_type, count in signal_rows}
    artifact_count = len(visible_artifact_ids)
    return memory_counts, edge_counts, artifact_count, signal_counts


def _timeline_status(memory: MemoryRecord, *, node_id: str, edges: list[GraphEdge]) -> str:
    if memory.memory_type == "commitment":
        if memory.status == "closed":
            return "closed"
        if memory.due_date and memory.due_date < datetime.utcnow():
            return "overdue"
        return memory.status or "open"
    if memory.memory_type == "assumption":
        return memory.status or "active"
    if memory.memory_type == "decision":
        if any(edge.edge_type == "SUPERSEDES" and edge.to_node_id == node_id for edge in edges):
            return "superseded"
        if any(edge.edge_type == "CONTRADICTS" for edge in edges):
            return "contested"
        return memory.status or "active"
    if memory.memory_type == "outcome":
        return "observed"
    return memory.status or "active"


def graph_timeline(db: Session, user: User, *, limit: int = 40) -> list[GraphTimelineItem]:
    visible_artifact_ids = _review_priority_visible_artifact_ids(db, user)
    memories = [memory for memory in _load_memory_records(db, user) if memory.source_artifact_id in visible_artifact_ids]
    nodes_by_id = _load_nodes_by_id(db, user)
    node_id_by_entity_id = {node.entity_id: node_id for node_id, node in nodes_by_id.items()}
    edges = [
        edge
        for edge in _visible_edges(db, user)
        if edge.evidence_artifact_id is None or edge.evidence_artifact_id in visible_artifact_ids
    ]
    edges_by_node_id: dict[str, list[GraphEdge]] = {}
    for edge in edges:
        edges_by_node_id.setdefault(edge.from_node_id, []).append(edge)
        edges_by_node_id.setdefault(edge.to_node_id, []).append(edge)
    artifact_titles = _artifact_title_map(db, visible_artifact_ids)

    items: list[GraphTimelineItem] = []
    for memory in memories:
        node_id = node_id_by_entity_id.get(memory.memory_id)
        if not node_id:
            continue
        related_edges = [edge for edge in edges_by_node_id.get(node_id, []) if edge.edge_type != "MENTIONED_IN"]
        contradiction_count = sum(1 for edge in related_edges if edge.edge_type == "CONTRADICTS")
        supersedes_count = sum(1 for edge in related_edges if edge.edge_type == "SUPERSEDES")
        items.append(
            GraphTimelineItem(
                memory_type=memory.memory_type,
                memory_id=memory.memory_id,
                title_or_label=memory.title_or_label,
                event_timestamp=memory.event_timestamp,
                timeline_status=_timeline_status(memory, node_id=node_id, edges=related_edges),
                topic_key=memory.topic_key,
                source_artifact_id=memory.source_artifact_id,
                source_artifact_title=_artifact_title_for_id(artifact_titles, memory.source_artifact_id),
                source_chunk_id=memory.source_chunk_id,
                evidence_span=memory.evidence_span,
                owner_label=memory.owner_label,
                due_date=memory.due_date,
                contradiction_count=contradiction_count,
                supersedes_count=supersedes_count,
                related_count=len(related_edges),
            )
        )

    items.sort(
        key=lambda item: (
            item.event_timestamp,
            item.contradiction_count,
            item.supersedes_count,
            item.related_count,
        ),
        reverse=True,
    )
    return items[:limit]


def graph_neighborhood(db: Session, user: User, *, memory_type: str, memory_id: str, limit: int = 12) -> GraphNeighborhood | None:
    visible_artifact_ids = _review_priority_visible_artifact_ids(db, user)
    memories = [memory for memory in _load_memory_records(db, user) if memory.source_artifact_id in visible_artifact_ids]
    center_memory = next((memory for memory in memories if memory.memory_type == memory_type and memory.memory_id == memory_id), None)
    if center_memory is None:
        return None

    nodes_by_id = _load_nodes_by_id(db, user)
    node_id_by_entity_id = {node.entity_id: node_id for node_id, node in nodes_by_id.items()}
    center_node_id = node_id_by_entity_id.get(center_memory.memory_id)
    if center_node_id is None:
        return None

    memories_by_id = {memory.memory_id: memory for memory in memories}
    edges = [
        edge
        for edge in _visible_edges(db, user)
        if edge.evidence_artifact_id is None or edge.evidence_artifact_id in visible_artifact_ids
    ]
    artifact_titles = _artifact_title_map(db, visible_artifact_ids)
    neighbors: list[GraphNeighborhoodNeighbor] = []
    for edge in edges:
        if edge.edge_type == "MENTIONED_IN":
            continue
        if edge.from_node_id != center_node_id and edge.to_node_id != center_node_id:
            continue
        direction = "outgoing" if edge.from_node_id == center_node_id else "incoming"
        other_node_id = edge.to_node_id if direction == "outgoing" else edge.from_node_id
        other_node = nodes_by_id.get(other_node_id)
        if other_node is None:
            continue
        other_memory = memories_by_id.get(other_node.entity_id)
        if other_memory is None:
            continue
        evidence_artifact_title = _artifact_title_for_id(artifact_titles, edge.evidence_artifact_id)
        evidence_span = _evidence_excerpt(
            db,
            chunk_id=edge.evidence_chunk_id,
            fallback=edge.evidence_span or other_memory.evidence_span or other_memory.normalized_text,
        )
        evidence_provenance = (
            f"{edge.edge_type} edge recorded in {evidence_artifact_title} linking '{center_memory.title_or_label}' and '{other_memory.title_or_label}'."
            if edge.evidence_artifact_id
            else f"{edge.edge_type} edge linking '{center_memory.title_or_label}' and '{other_memory.title_or_label}' without a direct artifact reference."
        )
        neighbors.append(
            GraphNeighborhoodNeighbor(
                edge_id=edge.edge_id,
                edge_type=edge.edge_type,
                direction=direction,
                related_memory_type=other_memory.memory_type,
                related_memory_id=other_memory.memory_id,
                related_title_or_label=other_memory.title_or_label,
                related_topic_key=other_memory.topic_key,
                related_status=other_memory.status,
                evidence_artifact_id=edge.evidence_artifact_id,
                evidence_artifact_title=evidence_artifact_title if edge.evidence_artifact_id else None,
                evidence_chunk_id=edge.evidence_chunk_id,
                evidence_span=evidence_span,
                evidence_provenance=evidence_provenance,
                confidence_score=edge.confidence_score,
            )
        )

    neighbors.sort(
        key=lambda item: (
            1 if item.edge_type in {"CONTRADICTS", "SUPERSEDES"} else 0,
            item.confidence_score,
            item.related_title_or_label,
        ),
        reverse=True,
    )
    return GraphNeighborhood(
        center_memory_type=center_memory.memory_type,
        center_memory_id=center_memory.memory_id,
        center_title_or_label=center_memory.title_or_label,
        center_topic_key=center_memory.topic_key,
        center_event_timestamp=center_memory.event_timestamp,
        neighbors=neighbors[:limit],
    )
