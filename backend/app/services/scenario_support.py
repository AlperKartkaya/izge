from __future__ import annotations

import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Artifact, Assumption, Commitment, Constraint, Decision, Outcome, User
from app.services.permissions import artifact_is_visible_to_user

SCENARIO_MODELS = [
    ("assumption", Assumption, "assumption_id"),
    ("commitment", Commitment, "commitment_id"),
    ("constraint", Constraint, "constraint_id"),
    ("decision", Decision, "decision_id"),
    ("outcome", Outcome, "outcome_id"),
]
STOPWORDS = {"the", "and", "for", "with", "that", "this", "would", "could", "should", "about", "into", "from", "your", "company", "team"}


def _tokens(value: str) -> set[str]:
    return {token for token in re.findall(r"[a-z0-9]+", value.lower()) if len(token) > 2 and token not in STOPWORDS}


def _impact_reason(memory_type: str, label: str, overlap: set[str]) -> str:
    shared = ", ".join(sorted(overlap)[:6]) or "the scenario topic"
    if memory_type == "assumption":
        return f"This assumption should be rechecked because it shares evidence terms with the scenario: {shared}."
    if memory_type == "commitment":
        return f"This commitment may need owner/date review because the scenario touches: {shared}."
    if memory_type == "constraint":
        return f"This constraint may limit the scenario because it overlaps with: {shared}."
    return f"This remembered item is relevant context for the scenario because it overlaps with: {shared}."


def build_scenario_impact(db: Session, user: User, *, scenario_text: str, limit: int = 10) -> dict[str, Any]:
    scenario_tokens = _tokens(scenario_text)
    artifacts = db.scalars(select(Artifact).where(Artifact.workspace_id == user.workspace_id)).all()
    visible_artifacts = {
        artifact.artifact_id: artifact
        for artifact in artifacts
        if artifact.review_status != "rejected" and artifact_is_visible_to_user(db, artifact, user)
    }
    impacted: list[dict[str, Any]] = []
    visible_artifact_ids = list(visible_artifacts)
    for memory_type, model, id_attr in SCENARIO_MODELS:
        rows = db.scalars(select(model).where(model.workspace_id == user.workspace_id, model.source_artifact_id.in_(visible_artifact_ids))).all()
        for row in rows:
            haystack = f"{row.title_or_label} {row.normalized_text} {row.topic_key}"
            overlap = scenario_tokens & _tokens(haystack)
            if not overlap:
                continue
            artifact = visible_artifacts.get(row.source_artifact_id)
            impacted.append(
                {
                    "memory_type": memory_type,
                    "memory_id": str(getattr(row, id_attr)),
                    "title_or_label": row.title_or_label,
                    "impact_reason": _impact_reason(memory_type, row.title_or_label, overlap),
                    "source_artifact_id": row.source_artifact_id,
                    "source_artifact_title": artifact.title if artifact else "Unknown artifact",
                    "source_chunk_id": row.source_chunk_id,
                    "confidence_score": min(1.0, 0.35 + len(overlap) * 0.08),
                    "evidence_excerpt": row.evidence_span or row.normalized_text[:220],
                }
            )
    impacted.sort(key=lambda item: item["confidence_score"], reverse=True)
    impacted = impacted[:limit]
    uncertainty_notes = []
    if not impacted:
        uncertainty_notes.append("No permitted evidence-backed memory objects overlapped with this scenario; Izge should ask for more source artifacts before forecasting.")
    else:
        uncertainty_notes.append("This is bounded scenario support: it identifies known memory likely to be affected, not an unsupported forecast.")
    return {
        "scenario_text": scenario_text,
        "answer_text": (
            f"Found {len(impacted)} evidence-backed memory object(s) that should be reviewed before acting on this scenario."
            if impacted
            else "No evidence-backed impact path could be reconstructed from the current memory."
        ),
        "impacted_memory": impacted,
        "recommended_questions": [
            "Which of these assumptions needs a fresh artifact before the company acts?",
            "Which commitment owner or due date changes if this scenario is accepted?",
            "Which constraints make this scenario unsafe or premature?",
        ],
        "uncertainty_notes": uncertainty_notes,
    }
