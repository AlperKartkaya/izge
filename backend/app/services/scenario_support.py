from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import re
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Artifact, Assumption, Commitment, Constraint, Decision, Outcome, ScenarioRun, User
from app.services.permissions import artifact_is_visible_to_user

SCENARIO_MODELS = [
    ("assumption", Assumption, "assumption_id"),
    ("commitment", Commitment, "commitment_id"),
    ("constraint", Constraint, "constraint_id"),
    ("decision", Decision, "decision_id"),
    ("outcome", Outcome, "outcome_id"),
]
STOPWORDS = {"the", "and", "for", "with", "that", "this", "would", "could", "should", "about", "into", "from", "your", "company"}
CLASSIFIER_VERSION = "scenario_classifier.v1"
TEMPLATE_CATALOG_VERSION = "scenario_template_catalog.v1"
SCENARIO_RANKING_RECIPE_VERSION = "scenario_ranking_recipe.v1"
SCENARIO_RANKING_RECIPE = {
    "recipe_version": SCENARIO_RANKING_RECIPE_VERSION,
    "score_components": [
        {"name": "matched_scenario_terms", "weight": 0.08, "direction": "desc"},
        {"name": "selected_template_confidence_boost", "weight": 0.12, "direction": "desc"},
    ],
    "primary_sort": {"field": "confidence_score", "direction": "desc"},
    "tie_breakers": [
        {"field": "memory_type", "direction": "asc"},
        {"field": "source_artifact_id", "direction": "asc"},
        {"field": "source_chunk_id", "direction": "asc", "null_value": ""},
        {"field": "memory_id", "direction": "asc"},
    ],
}


@dataclass(frozen=True)
class ScenarioTemplate:
    template_key: str
    title: str
    keywords: set[str]
    review_lens: list[str]
    example_prompts: list[str]


SCENARIO_TEMPLATES = [
    ScenarioTemplate(
        template_key="launch_change",
        title="Launch acceleration or delay",
        keywords={"launch", "release", "rollout", "onboarding", "activation", "adoption", "pipeline", "customer", "enterprise"},
        review_lens=[
            "Recheck launch-readiness assumptions against later evidence.",
            "Identify commitments whose owner or due date changes.",
            "Surface constraints that block acceleration or delay decisions.",
        ],
        example_prompts=[
            "What changes if we accelerate the enterprise onboarding launch?",
            "What known work is affected if launch slips by one quarter?",
        ],
    ),
    ScenarioTemplate(
        template_key="pricing_or_packaging",
        title="Pricing or packaging change",
        keywords={"pricing", "price", "packaging", "monetization", "revenue", "discount", "tier", "plan", "sales"},
        review_lens=[
            "Check decisions and constraints tied to packaging or revenue assumptions.",
            "Review commitments to sales, support, or customer success teams.",
            "Ask for fresh evidence before projecting financial outcomes.",
        ],
        example_prompts=[
            "What memory is affected if we introduce a new enterprise tier?",
            "Which assumptions need review before discounting annual plans?",
        ],
    ),
    ScenarioTemplate(
        template_key="platform_migration",
        title="Platform migration or architecture shift",
        keywords={"migration", "platform", "infrastructure", "infra", "database", "backend", "rewrite", "vendor", "integration"},
        review_lens=[
            "Find constraints and prior decisions that bound the migration path.",
            "Review commitments that depend on the current platform.",
            "Separate evidence-backed impact from unsupported delivery forecasts.",
        ],
        example_prompts=[
            "Which existing constraints or decisions should be reviewed before migrating the memory store to a managed database?",
            "Which constraints matter before replacing a vendor integration?",
        ],
    ),
    ScenarioTemplate(
        template_key="compliance_or_security",
        title="Compliance, security, or audit requirement",
        keywords={"compliance", "security", "audit", "privacy", "legal", "regulator", "risk", "soc2", "gdpr", "approval"},
        review_lens=[
            "Surface constraints, approvals, and review obligations.",
            "Identify assumptions that require fresh security or legal evidence.",
            "Avoid treating missing approval as a forecastable outcome.",
        ],
        example_prompts=[
            "What memory is affected if security approval is required before launch?",
            "Which assumptions need review for a new compliance obligation?",
        ],
    ),
    ScenarioTemplate(
        template_key="org_change",
        title="Org, ownership, or staffing change",
        keywords={"hiring", "team", "org", "organization", "reorg", "owner", "ownership", "process", "support", "staffing", "handoff"},
        review_lens=[
            "Review commitments whose owner or due date may change.",
            "Find prior decisions that explain the current operating model.",
            "Ask for source artifacts before assuming capacity changes.",
        ],
        example_prompts=[
            "Which commitments are affected if ownership moves to growth?",
            "What prior work matters before changing support staffing?",
        ],
    ),
]


GENERAL_TEMPLATE = ScenarioTemplate(
    template_key="general_memory_review",
    title="General bounded memory review",
    keywords=set(),
    review_lens=[
        "Identify overlapping evidence-backed memory.",
        "Ask which assumptions, commitments, or constraints need a fresh artifact.",
        "Do not forecast without direct source evidence.",
    ],
    example_prompts=[
        "Which existing decisions or assumptions are affected by this change?",
        "What evidence should we collect before acting on this scenario?",
    ],
)


def _tokens(value: str) -> set[str]:
    return {token for token in re.findall(r"[a-z0-9]+", value.lower()) if len(token) > 2 and token not in STOPWORDS}


def _hash_payload(payload: Any) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _hash_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def list_scenario_templates() -> list[dict[str, Any]]:
    return [
        {
            "template_catalog_version": TEMPLATE_CATALOG_VERSION,
            "template_key": template.template_key,
            "title": template.title,
            "keywords": sorted(template.keywords),
            "review_lens": template.review_lens,
            "example_prompts": template.example_prompts,
        }
        for template in SCENARIO_TEMPLATES
    ]


def _rank_template_candidates(scenario_tokens: set[str]) -> list[tuple[int, ScenarioTemplate, list[str]]]:
    ranked: list[tuple[int, int, ScenarioTemplate, list[str]]] = []
    for order, template in enumerate(SCENARIO_TEMPLATES):
        matched_terms = sorted(scenario_tokens & template.keywords)
        ranked.append((len(matched_terms), order, template, matched_terms))
    ranked.sort(key=lambda item: (-item[0], item[1]))
    return [(score, template, matched_terms) for score, _order, template, matched_terms in ranked]


def _template_confidence(score: int) -> float:
    if score == 0:
        return 0.25
    return round(min(0.95, 0.45 + score * 0.1), 2)


def _classify_template(scenario_tokens: set[str]) -> tuple[ScenarioTemplate, list[str], float]:
    ranked = _rank_template_candidates(scenario_tokens)
    score, template, matched_terms = ranked[0]
    if score == 0:
        return GENERAL_TEMPLATE, [], 0.25
    return template, matched_terms, _template_confidence(score)


def _impact_reason(memory_type: str, overlap: set[str], template: ScenarioTemplate) -> str:
    shared = ", ".join(sorted(overlap)[:6]) or "the scenario topic"
    lens = template.review_lens[0] if template.review_lens else "Review this memory before action."
    if memory_type == "assumption":
        return f"This assumption should be rechecked for the {template.title.lower()} scenario because it shares evidence terms: {shared}. {lens}"
    if memory_type == "commitment":
        return f"This commitment may need owner/date review for the {template.title.lower()} scenario because it touches: {shared}."
    if memory_type == "constraint":
        return f"This constraint may limit the {template.title.lower()} scenario because it overlaps with: {shared}."
    return f"This remembered item is relevant context for the {template.title.lower()} scenario because it overlaps with: {shared}."


def _scenario_template_payload(template: ScenarioTemplate, matched_terms: list[str], confidence_score: float) -> dict[str, Any]:
    return {
        "template_key": template.template_key,
        "title": template.title,
        "confidence_score": confidence_score,
        "matched_terms": matched_terms,
        "review_lens": template.review_lens,
        "example_prompts": template.example_prompts,
    }


def _scenario_template_candidates_payload(scenario_tokens: set[str]) -> list[dict[str, Any]]:
    ranked = _rank_template_candidates(scenario_tokens)
    matched = [
        _scenario_template_payload(template, matched_terms, _template_confidence(score))
        for score, template, matched_terms in ranked
        if score > 0
    ]
    if matched:
        return matched
    return [_scenario_template_payload(GENERAL_TEMPLATE, [], 0.25)]


def _memory_ref(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "memory_type": item["memory_type"],
        "memory_id": item["memory_id"],
        "title_or_label": item["title_or_label"],
        "source_artifact_id": item["source_artifact_id"],
        "source_chunk_id": item["source_chunk_id"],
        "confidence_score": item["confidence_score"],
        "matched_terms": item["matched_terms"],
        "ranking_key": item["ranking_key"],
    }


def _evidence_ref(item: dict[str, Any]) -> dict[str, Any]:
    excerpt = str(item["evidence_excerpt"])
    return {
        "artifact_id": item["source_artifact_id"],
        "artifact_title": item["source_artifact_title"],
        "artifact_review_status": item["source_artifact_review_status"],
        "chunk_id": item["source_chunk_id"],
        "excerpt": excerpt,
        "excerpt_hash": f"sha256:{_hash_text(excerpt)}",
    }


def _candidate_snapshot(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            **_memory_ref(item),
            "evidence_excerpt_hash": f"sha256:{_hash_text(str(item['evidence_excerpt']))}",
            "source_artifact_review_status": item["source_artifact_review_status"],
        }
        for item in candidates
    ]


def _scenario_packet_payload(
    *,
    scenario_text: str,
    scenario_tokens: set[str],
    template: ScenarioTemplate,
    impacted: list[dict[str, Any]],
    candidates: list[dict[str, Any]],
    visible_artifact_count: int,
    hidden_or_rejected_count: int,
    limit: int,
    impacted_candidate_count: int,
) -> dict[str, Any]:
    selected_artifact_ids = sorted({item["source_artifact_id"] for item in impacted})
    selected_memory_refs = [_memory_ref(item) for item in impacted]
    selected_evidence_refs = [_evidence_ref(item) for item in impacted]
    scenario_text_hash = f"sha256:{_hash_text(scenario_text)}"
    candidate_snapshot = _candidate_snapshot(candidates)
    candidate_snapshot_hash = f"sha256:{_hash_payload(candidate_snapshot)}"
    input_snapshot_payload = {
        'classifier_version': CLASSIFIER_VERSION,
        'template_catalog_version': TEMPLATE_CATALOG_VERSION,
        'ranking_recipe': SCENARIO_RANKING_RECIPE,
        'scenario_terms': sorted(scenario_tokens),
        'scenario_text_hash': scenario_text_hash,
        'candidate_snapshot_hash': candidate_snapshot_hash,
        'limit': limit,
    }
    input_snapshot_hash = f"sha256:{_hash_payload(input_snapshot_payload)}"
    packet_payload = {
        'scenario_text_hash': scenario_text_hash,
        'input_snapshot_hash': input_snapshot_hash,
        'classifier_version': CLASSIFIER_VERSION,
        'template_catalog_version': TEMPLATE_CATALOG_VERSION,
        'ranking_recipe': SCENARIO_RANKING_RECIPE,
        'selected_template_key': template.template_key,
        'selected_memory_ids': [item['memory_id'] for item in impacted],
        'candidate_snapshot_hash': candidate_snapshot_hash,
        'limit': limit,
    }
    packet_id = f"scp_{_hash_payload(packet_payload)[:24]}"
    return {
        "schema_version": "scenario_context_packet.v1",
        "packet_type": "bounded_scenario_impact",
        "packet_id": packet_id,
        "scenario_text_hash": scenario_text_hash,
        "classifier_version": CLASSIFIER_VERSION,
        "template_catalog_version": TEMPLATE_CATALOG_VERSION,
        "ranking_recipe": SCENARIO_RANKING_RECIPE,
        "candidate_snapshot_hash": candidate_snapshot_hash,
        "input_snapshot_hash": input_snapshot_hash,
        "selected_template_key": template.template_key,
        "scenario_terms": sorted(scenario_tokens)[:24],
        "selected_memory_ids": [item["memory_id"] for item in impacted],
        "selected_memory_refs": selected_memory_refs,
        "candidate_memory_snapshot": candidate_snapshot,
        "selected_artifact_ids": selected_artifact_ids,
        "selected_evidence_refs": selected_evidence_refs,
        "omitted_reasons": [
            {"reason": "permission_hidden_or_rejected", "count": hidden_or_rejected_count},
            {"reason": "scenario_budget", "count": max(impacted_candidate_count - limit, 0)},
        ],
        "evidence_budget": {
            "max_impacted_memory": limit,
            "selected_memory_count": len(impacted),
            "candidate_memory_count": impacted_candidate_count,
            "selected_artifact_count": len(selected_artifact_ids),
            "visible_artifact_count": visible_artifact_count,
            "within_budget": len(impacted) <= limit,
        },
        "replay_contract": {
            "deterministic_inputs": [
                "scenario_text_hash",
                "classifier_version",
                "template_catalog_version",
                "ranking_recipe",
                "candidate_snapshot_hash",
                "current_user_artifact_permissions",
            ],
            "input_snapshot_hash": input_snapshot_hash,
            "candidate_snapshot_hash": candidate_snapshot_hash,
            "selection_recipe": SCENARIO_RANKING_RECIPE,
            "replay_mode": "deterministic_selection_summary",
            "replay_requires_current_permissions": True,
            "trusted_write_allowed": False,
            "forecasting_allowed": False,
        },
    }


def _visible_trusted_artifact_ids(db: Session, user: User) -> set[str]:
    return {
        artifact.artifact_id
        for artifact in db.scalars(select(Artifact).where(Artifact.workspace_id == user.workspace_id)).all()
        if artifact.review_status != "rejected" and artifact_is_visible_to_user(db, artifact, user)
    }


def build_scenario_impact(db: Session, user: User, *, scenario_text: str, limit: int = 10, persist_run: bool = False) -> dict[str, Any]:
    scenario_tokens = _tokens(scenario_text)
    template, matched_template_terms, template_confidence = _classify_template(scenario_tokens)
    artifacts = db.scalars(select(Artifact).where(Artifact.workspace_id == user.workspace_id).order_by(Artifact.artifact_id)).all()
    visible_artifacts = {
        artifact.artifact_id: artifact
        for artifact in artifacts
        if artifact.review_status != "rejected" and artifact_is_visible_to_user(db, artifact, user)
    }
    impacted: list[dict[str, Any]] = []
    visible_artifact_ids = list(visible_artifacts)
    hidden_or_rejected_count = max(len(artifacts) - len(visible_artifacts), 0)
    for memory_type, model, id_attr in SCENARIO_MODELS:
        id_column = getattr(model, id_attr)
        rows = db.scalars(
            select(model)
            .where(model.workspace_id == user.workspace_id, model.source_artifact_id.in_(visible_artifact_ids))
            .order_by(model.source_artifact_id, model.source_chunk_id, id_column)
        ).all()
        for row in rows:
            haystack = f"{row.title_or_label} {row.normalized_text} {row.topic_key}"
            overlap = scenario_tokens & _tokens(haystack)
            if not overlap:
                continue
            artifact = visible_artifacts.get(row.source_artifact_id)
            memory_id = str(getattr(row, id_attr))
            confidence_score = round(min(1.0, 0.35 + len(overlap) * 0.08 + (template_confidence * 0.12)), 4)
            source_chunk_id = row.source_chunk_id
            impacted.append(
                {
                    "memory_type": memory_type,
                    "memory_id": memory_id,
                    "title_or_label": row.title_or_label,
                    "impact_reason": _impact_reason(memory_type, overlap, template),
                    "matched_terms": sorted(overlap)[:8],
                    "source_artifact_id": row.source_artifact_id,
                    "source_artifact_title": artifact.title if artifact else "Unknown artifact",
                    "source_artifact_review_status": artifact.review_status if artifact else "unknown",
                    "source_chunk_id": source_chunk_id,
                    "confidence_score": confidence_score,
                    "ranking_key": [
                        f"confidence:{confidence_score:.4f}",
                        f"memory_type:{memory_type}",
                        f"source_artifact_id:{row.source_artifact_id}",
                        f"source_chunk_id:{source_chunk_id or ''}",
                        f"memory_id:{memory_id}",
                    ],
                    "evidence_excerpt": row.evidence_span or row.normalized_text[:220],
                }
            )
    impacted.sort(
        key=lambda item: (
            -float(item["confidence_score"]),
            str(item["memory_type"]),
            str(item["source_artifact_id"]),
            str(item["source_chunk_id"] or ""),
            str(item["memory_id"]),
        )
    )
    impacted_candidate_count = len(impacted)
    candidates = list(impacted)
    impacted = impacted[:limit]
    uncertainty_notes = []
    if not impacted:
        uncertainty_notes.append("No permitted evidence-backed memory objects overlapped with this scenario; Izge should ask for more source artifacts before forecasting.")
    else:
        uncertainty_notes.append("This is bounded scenario support: it identifies known memory likely to be affected, not an unsupported forecast.")
    if template.template_key == "general_memory_review":
        uncertainty_notes.append("No specific scenario template dominated; the response uses a general memory-review lens.")
    candidate_templates = _scenario_template_candidates_payload(scenario_tokens)
    if len(candidate_templates) > 1:
        secondary_titles = ", ".join(item["title"] for item in candidate_templates[1:3])
        uncertainty_notes.append(f"Multiple scenario lenses matched; secondary review lenses include {secondary_titles}.")
    scenario_template = _scenario_template_payload(template, matched_template_terms, template_confidence)
    result = {
        "scenario_text": scenario_text,
        "scenario_template": scenario_template,
        "candidate_templates": candidate_templates,
        "scenario_packet": _scenario_packet_payload(
            scenario_text=scenario_text,
            scenario_tokens=scenario_tokens,
            template=template,
            impacted=impacted,
            candidates=candidates,
            visible_artifact_count=len(visible_artifacts),
            hidden_or_rejected_count=hidden_or_rejected_count,
            limit=limit,
            impacted_candidate_count=impacted_candidate_count,
        ),
        "answer_text": (
            f"Using the {template.title.lower()} lens, found {len(impacted)} evidence-backed memory object(s) that should be reviewed before acting on this scenario."
            if impacted
            else "No evidence-backed impact path could be reconstructed from the current memory."
        ),
        "impacted_memory": impacted,
        "recommended_questions": [
            *template.review_lens,
            "Which of these memory objects needs a fresh artifact before the company acts?",
        ],
        "uncertainty_notes": uncertainty_notes,
    }
    if persist_run:
        run = persist_scenario_run(db, user, result)
        result["scenario_run_id"] = run.scenario_run_id
    return result


def _scenario_run_summary_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    packet = payload.get("scenario_packet") if isinstance(payload.get("scenario_packet"), dict) else {}
    evidence_budget = packet.get("evidence_budget") if isinstance(packet.get("evidence_budget"), dict) else {}
    return {
        "selected_memory_count": int(evidence_budget.get("selected_memory_count") or 0),
        "candidate_memory_count": int(evidence_budget.get("candidate_memory_count") or 0),
        "selected_memory_ids": [str(item) for item in packet.get("selected_memory_ids", []) if isinstance(item, str)],
    }


def persist_scenario_run(db: Session, user: User, result_payload: dict[str, Any]) -> ScenarioRun:
    packet = result_payload.get("scenario_packet") if isinstance(result_payload.get("scenario_packet"), dict) else {}
    summary = _scenario_run_summary_from_payload(result_payload)
    replay_summary = {
        "schema_version": "scenario_replay_summary.v1",
        "verdict": "original",
        "selected_memory_count": summary["selected_memory_count"],
        "candidate_memory_count": summary["candidate_memory_count"],
        "created_from": "scenario_impact",
    }
    run = ScenarioRun(
        workspace_id=user.workspace_id,
        created_by=user.user_id,
        scenario_text=str(result_payload.get("scenario_text") or ""),
        scenario_text_hash=str(packet.get("scenario_text_hash") or ""),
        packet_id=str(packet.get("packet_id") or ""),
        selected_template_key=str(packet.get("selected_template_key") or ""),
        input_snapshot_hash=str(packet.get("input_snapshot_hash") or ""),
        candidate_snapshot_hash=str(packet.get("candidate_snapshot_hash") or ""),
        scenario_packet=packet,
        result_payload={**result_payload, "scenario_run_id": None},
        replay_summary=replay_summary,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    run.result_payload = {**result_payload, "scenario_run_id": run.scenario_run_id}
    db.commit()
    db.refresh(run)
    return run


def _run_visible_to_user(run: ScenarioRun, user: User) -> bool:
    return user.role == "Admin" or run.created_by == user.user_id


def _filter_scenario_result_for_reader(db: Session, user: User, payload: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    visible_artifact_ids = _visible_trusted_artifact_ids(db, user)
    filtered = dict(payload)
    packet = dict(filtered.get("scenario_packet") or {})
    redacted = False

    impacted = [item for item in filtered.get("impacted_memory", []) if isinstance(item, dict)]
    kept_impacted = [item for item in impacted if item.get("source_artifact_id") in visible_artifact_ids]
    redacted = redacted or len(kept_impacted) != len(impacted)
    filtered["impacted_memory"] = kept_impacted

    for key in ("selected_memory_refs", "candidate_memory_snapshot"):
        items = [item for item in packet.get(key, []) if isinstance(item, dict)]
        kept_items = [item for item in items if item.get("source_artifact_id") in visible_artifact_ids]
        redacted = redacted or len(kept_items) != len(items)
        packet[key] = kept_items

    evidence_refs = [item for item in packet.get("selected_evidence_refs", []) if isinstance(item, dict)]
    kept_evidence_refs = [item for item in evidence_refs if item.get("artifact_id") in visible_artifact_ids]
    redacted = redacted or len(kept_evidence_refs) != len(evidence_refs)
    packet["selected_evidence_refs"] = kept_evidence_refs
    packet["selected_artifact_ids"] = [item for item in packet.get("selected_artifact_ids", []) if item in visible_artifact_ids]
    packet["selected_memory_ids"] = [item.get("memory_id") for item in packet["selected_memory_refs"] if isinstance(item.get("memory_id"), str)]
    evidence_budget = dict(packet.get("evidence_budget") or {})
    evidence_budget["selected_memory_count"] = len(packet["selected_memory_refs"])
    evidence_budget["candidate_memory_count"] = len(packet.get("candidate_memory_snapshot", []))
    evidence_budget["selected_artifact_count"] = len(packet["selected_artifact_ids"])
    packet["evidence_budget"] = evidence_budget
    filtered["scenario_packet"] = packet
    if redacted:
        notes = list(filtered.get("uncertainty_notes") or [])
        notice = "This scenario run was reduced to currently permitted and review-accepted evidence."
        if notice not in notes:
            notes.append(notice)
        filtered["uncertainty_notes"] = notes
    return filtered, redacted


def _scenario_run_read_payload(db: Session, user: User, run: ScenarioRun) -> dict[str, Any]:
    payload, _redacted = _filter_scenario_result_for_reader(db, user, dict(run.result_payload or {}))
    return {
        "scenario_run_id": run.scenario_run_id,
        "workspace_id": run.workspace_id,
        "created_by": run.created_by,
        "scenario_text": run.scenario_text,
        "scenario_text_hash": run.scenario_text_hash,
        "packet_id": run.packet_id,
        "selected_template_key": run.selected_template_key,
        "input_snapshot_hash": run.input_snapshot_hash,
        "candidate_snapshot_hash": run.candidate_snapshot_hash,
        "result_payload": {**payload, "scenario_run_id": run.scenario_run_id},
        "replay_summary": run.replay_summary,
        "created_at": run.created_at,
    }


def list_scenario_runs(db: Session, user: User, *, limit: int = 30) -> dict[str, Any]:
    criteria = [ScenarioRun.workspace_id == user.workspace_id]
    if user.role != "Admin":
        criteria.append(ScenarioRun.created_by == user.user_id)
    rows = db.scalars(
        select(ScenarioRun)
        .where(*criteria)
        .order_by(ScenarioRun.created_at.desc(), ScenarioRun.scenario_run_id.desc())
        .limit(max(1, min(limit, 100)))
    ).all()
    runs = []
    for run in rows:
        payload, redacted = _filter_scenario_result_for_reader(db, user, dict(run.result_payload or {}))
        summary = _scenario_run_summary_from_payload(payload)
        runs.append(
            {
                "scenario_run_id": run.scenario_run_id,
                "scenario_text_hash": run.scenario_text_hash,
                "packet_id": run.packet_id,
                "selected_template_key": run.selected_template_key,
                "selected_memory_count": summary["selected_memory_count"],
                "candidate_memory_count": summary["candidate_memory_count"],
                "replay_verdict": "permission_limited" if redacted else str((run.replay_summary or {}).get("verdict") or "original"),
                "created_at": run.created_at,
            }
        )
    return {"workspace_id": user.workspace_id, "generated_at": datetime.now(UTC), "runs": runs}


def get_scenario_run(db: Session, user: User, scenario_run_id: str) -> dict[str, Any] | None:
    run = db.scalar(select(ScenarioRun).where(ScenarioRun.workspace_id == user.workspace_id, ScenarioRun.scenario_run_id == scenario_run_id))
    if run is None or not _run_visible_to_user(run, user):
        return None
    return _scenario_run_read_payload(db, user, run)


def replay_scenario_run(db: Session, user: User, scenario_run_id: str) -> dict[str, Any] | None:
    run = db.scalar(select(ScenarioRun).where(ScenarioRun.workspace_id == user.workspace_id, ScenarioRun.scenario_run_id == scenario_run_id))
    if run is None or not _run_visible_to_user(run, user):
        return None

    original_payload, redacted = _filter_scenario_result_for_reader(db, user, dict(run.result_payload or {}))
    original_packet = original_payload.get("scenario_packet") if isinstance(original_payload.get("scenario_packet"), dict) else {}
    original_budget = original_packet.get("evidence_budget") if isinstance(original_packet.get("evidence_budget"), dict) else {}
    limit = int(original_budget.get("max_impacted_memory") or 10)
    current_result = build_scenario_impact(db, user, scenario_text=run.scenario_text, limit=limit, persist_run=False)
    current_packet = current_result.get("scenario_packet") if isinstance(current_result.get("scenario_packet"), dict) else {}
    original_selected = {str(item) for item in original_packet.get("selected_memory_ids", []) if isinstance(item, str)}
    current_selected = {str(item) for item in current_packet.get("selected_memory_ids", []) if isinstance(item, str)}
    input_changed = run.input_snapshot_hash != current_packet.get("input_snapshot_hash")
    candidate_changed = run.candidate_snapshot_hash != current_packet.get("candidate_snapshot_hash")
    changed = input_changed or candidate_changed or original_selected != current_selected or run.selected_template_key != current_packet.get("selected_template_key")
    verdict = "permission_limited" if redacted else ("changed" if changed else "stable")
    replay_summary = {
        "schema_version": "scenario_replay_summary.v1",
        "verdict": verdict,
        "replayed_at": datetime.now(UTC).isoformat(),
        "current_packet_id": current_packet.get("packet_id"),
        "input_snapshot_changed": input_changed,
        "candidate_snapshot_changed": candidate_changed,
        "selected_memory_added": sorted(current_selected - original_selected),
        "selected_memory_removed": sorted(original_selected - current_selected),
    }
    run.replay_summary = replay_summary
    db.commit()
    db.refresh(run)
    summary_text = (
        "Replay is stable: the same template and selected memory set were reconstructed."
        if verdict == "stable"
        else "Replay changed: the scenario packet differs from the stored run under current evidence or permissions."
    )
    if verdict == "permission_limited":
        summary_text = "Replay is permission-limited: stored details were reduced to the current reader's trusted evidence scope."
    return {
        "scenario_run_id": run.scenario_run_id,
        "replayed_at": datetime.now(UTC),
        "verdict": verdict,
        "original_packet_id": run.packet_id,
        "current_packet_id": str(current_packet.get("packet_id") or ""),
        "original_template_key": run.selected_template_key,
        "current_template_key": str(current_packet.get("selected_template_key") or ""),
        "input_snapshot_changed": input_changed,
        "candidate_snapshot_changed": candidate_changed,
        "selected_memory_kept": sorted(original_selected & current_selected),
        "selected_memory_added": sorted(current_selected - original_selected),
        "selected_memory_removed": sorted(original_selected - current_selected),
        "summary": summary_text,
        "current_result": current_result,
    }
