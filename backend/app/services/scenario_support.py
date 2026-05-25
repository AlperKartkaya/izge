from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
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


def build_scenario_impact(db: Session, user: User, *, scenario_text: str, limit: int = 10) -> dict[str, Any]:
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
    return {
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
