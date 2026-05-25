from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    Artifact,
    ArtifactChunk,
    Assumption,
    Commitment,
    Constraint,
    Decision,
    GraphEdge,
    Outcome,
    QueryRun,
    QueryTraceStep,
    Signal,
    User,
)
from app.services.permissions import artifact_is_visible_to_user

MEMORY_MODELS = [
    ("decision", Decision),
    ("assumption", Assumption),
    ("constraint", Constraint),
    ("outcome", Outcome),
    ("commitment", Commitment),
]


def _count_by_artifact(db: Session, model: Any, artifact_ids: list[str]) -> dict[str, int]:
    if not artifact_ids:
        return {}
    rows = db.execute(
        select(model.source_artifact_id, func.count()).where(model.source_artifact_id.in_(artifact_ids)).group_by(model.source_artifact_id)
    ).all()
    return {str(artifact_id): int(count) for artifact_id, count in rows}


def _chunk_counts(db: Session, artifact_ids: list[str]) -> dict[str, int]:
    if not artifact_ids:
        return {}
    rows = db.execute(
        select(ArtifactChunk.artifact_id, func.count()).where(ArtifactChunk.artifact_id.in_(artifact_ids)).group_by(ArtifactChunk.artifact_id)
    ).all()
    return {str(artifact_id): int(count) for artifact_id, count in rows}


def _signal_counts(db: Session, artifact_ids: list[str]) -> dict[str, int]:
    if not artifact_ids:
        return {}
    rows = db.execute(
        select(Signal.source_artifact_id, func.count())
        .where(Signal.source_artifact_id.in_(artifact_ids), Signal.status == "active")
        .group_by(Signal.source_artifact_id)
    ).all()
    return {str(artifact_id): int(count) for artifact_id, count in rows if artifact_id is not None}


def _edge_counts(db: Session, artifact_ids: list[str]) -> dict[str, int]:
    if not artifact_ids:
        return {}
    rows = db.execute(
        select(GraphEdge.evidence_artifact_id, func.count())
        .where(GraphEdge.evidence_artifact_id.in_(artifact_ids))
        .group_by(GraphEdge.evidence_artifact_id)
    ).all()
    return {str(artifact_id): int(count) for artifact_id, count in rows if artifact_id is not None}


def _artifact_storage_locator(artifact: Artifact) -> str:
    return f"artifact://{artifact.artifact_id}/source"


def _retrieval_state(artifact: Artifact, chunk_count: int) -> str:
    if artifact.review_status == "rejected":
        return "stored_not_trusted"
    if artifact.ingestion_status != "completed":
        return "not_indexed_yet"
    if chunk_count == 0:
        return "ingested_without_chunks"
    if artifact.review_status in {"submitted", "needs_review"}:
        return "indexed_pending_trust_review"
    return "indexed_trusted"


def _trust_boundary(artifact: Artifact) -> str:
    if artifact.review_status == "rejected":
        return "Stored for audit, excluded from trusted reasoning and signal support."
    if artifact.review_status in {"submitted", "needs_review"}:
        return "Visible to permitted users, but still waiting for admin trust review."
    if artifact.visibility_scope == "restricted":
        return "Trusted only for users explicitly permitted to this restricted artifact."
    return "Trusted workspace evidence for permitted reasoning surfaces."


def _coverage_notes(artifact: Artifact, chunk_count: int, memory_total: int) -> list[str]:
    notes: list[str] = []
    if not artifact.checksum_sha256:
        notes.append("source checksum missing")
    if artifact.ingestion_status != "completed":
        notes.append(f"ingestion status is {artifact.ingestion_status}")
    if chunk_count == 0:
        notes.append("no chunks indexed yet")
    if artifact.ingestion_status == "completed" and memory_total == 0:
        notes.append("ingested but no structured memory objects extracted")
    if artifact.review_status != "reviewed":
        notes.append(f"review status is {artifact.review_status}")
    return notes or ["artifact has source checksum, chunks, and structured memory coverage"]


def _database_blueprint() -> list[dict[str, Any]]:
    return [
        {
            "layer": "1. Source artifacts",
            "table_names": ["artifacts", "artifact_permissions"],
            "purpose": "Immutable uploaded/pasted evidence plus visibility and review boundary.",
            "write_path": "Artifact upload or pasted text stores bytes/text first, then records checksum and metadata.",
            "read_path": "Memory file-system, artifact inventory, retrieval prefilter, admin review queue.",
            "organization_rule": "One artifact is the root of every downstream memory claim; never let generated output replace source evidence.",
        },
        {
            "layer": "2. Evidence chunks",
            "table_names": ["artifact_chunks", "artifact_chunks_fts"],
            "purpose": "Retrievable source slices with sequence order and extraction metadata.",
            "write_path": "Ingestion parses supported text/PDF input and stores ordered chunks plus FTS rows.",
            "read_path": "Graph evidence, query fallback, memory detail, query traces.",
            "organization_rule": "Chunks are the internal file-system leaves; each answer should be traceable back to selected chunk locators.",
        },
        {
            "layer": "3. Structured memory objects",
            "table_names": ["decisions", "assumptions", "constraints", "outcomes", "commitments"],
            "purpose": "Typed institutional memory extracted from chunks.",
            "write_path": "Extraction writes typed objects with topic, confidence, event time, source artifact, and source chunk.",
            "read_path": "Lineage, contradiction, drift, next-action reasoning, memory detail.",
            "organization_rule": "Use memory objects as the reasoning substrate, not raw-document search results.",
        },
        {
            "layer": "4. Knowledge graph",
            "table_names": ["graph_nodes", "graph_edges"],
            "purpose": "Typed links among memory objects and source-backed conflict/supersession/continuity relationships.",
            "write_path": "Ingestion links extracted memory into graph nodes and edges with evidence pointers.",
            "read_path": "Graph timeline, graph neighborhood, query support, signal generation.",
            "organization_rule": "Edges must remain evidence-backed; future temporal KG should add claim-occurrence and edge-evidence layers before richer graph claims.",
        },
        {
            "layer": "5. Signals and traces",
            "table_names": ["signals", "query_runs", "query_trace_steps", "audit_events"],
            "purpose": "Durable proactive findings, query packets, orchestration trace, and governance audit.",
            "write_path": "Ingestion/query generates signals and trace events after deterministic evidence selection.",
            "read_path": "Dashboard, signal detail, query result trace, audit page, orchestration page.",
            "organization_rule": "Every AI-assisted or orchestration stage must leave a trace showing input evidence, proposed output, and deterministic acceptance gate.",
        },
    ]


def _organization_guide() -> list[dict[str, str]]:
    return [
        {
            "step": "1",
            "title": "Create a company workspace boundary",
            "description": "Run one customer-controlled deployment per company workspace, with isolated SQLite/storage volumes or a future per-company database schema.",
        },
        {
            "step": "2",
            "title": "Store raw artifacts first",
            "description": "Persist each uploaded file or pasted text with checksum, source type, visibility, review status, and uploader before any AI or extraction step runs.",
        },
        {
            "step": "3",
            "title": "Chunk evidence deterministically",
            "description": "Turn each artifact into ordered chunks. Treat chunks as the internal file-system leaves that retrieval and memory extraction can cite.",
        },
        {
            "step": "4",
            "title": "Extract typed memory objects",
            "description": "Write decisions, assumptions, constraints, outcomes, and commitments with source artifact/chunk pointers and confidence metadata.",
        },
        {
            "step": "5",
            "title": "Link the graph and signals",
            "description": "Create graph nodes/edges, contradiction/drift/supersession signals, and next actions only from visible evidence-backed memory objects.",
        },
        {
            "step": "6",
            "title": "Expose trace and governance",
            "description": "Show selected evidence, omitted evidence, permission limits, admin review status, query trace, and audit events before presenting recommendations as actionable.",
        },
    ]


def build_memory_filesystem(db: Session, user: User) -> dict[str, Any]:
    all_artifacts = db.scalars(
        select(Artifact).where(Artifact.workspace_id == user.workspace_id).order_by(Artifact.created_at.desc())
    ).all()
    visible_artifacts = [artifact for artifact in all_artifacts if artifact_is_visible_to_user(db, artifact, user)]
    artifact_ids = [artifact.artifact_id for artifact in visible_artifacts]

    chunk_counts = _chunk_counts(db, artifact_ids)
    signal_counts = _signal_counts(db, artifact_ids)
    edge_counts = _edge_counts(db, artifact_ids)
    memory_counts_by_type = {
        memory_type: _count_by_artifact(db, model, artifact_ids) for memory_type, model in MEMORY_MODELS
    }

    artifact_items: list[dict[str, Any]] = []
    total_chunks = 0
    total_memory = 0
    total_signals = 0
    for artifact in visible_artifacts:
        chunk_count = chunk_counts.get(artifact.artifact_id, 0)
        memory_counts = {memory_type: counts.get(artifact.artifact_id, 0) for memory_type, counts in memory_counts_by_type.items()}
        memory_total = sum(memory_counts.values())
        total_chunks += chunk_count
        total_memory += memory_total
        total_signals += signal_counts.get(artifact.artifact_id, 0)
        organization_path = [
            "workspace",
            "evidence-substrate",
            artifact.review_status,
            artifact.source_type,
            artifact.artifact_id,
        ]
        artifact_items.append(
            {
                "artifact_id": artifact.artifact_id,
                "title": artifact.title,
                "source_type": artifact.source_type,
                "storage_locator": _artifact_storage_locator(artifact),
                "checksum_sha256": artifact.checksum_sha256,
                "mime_type": artifact.mime_type,
                "visibility_scope": artifact.visibility_scope,
                "ingestion_status": artifact.ingestion_status,
                "review_status": artifact.review_status,
                "created_at": artifact.created_at,
                "updated_at": artifact.updated_at,
                "chunk_count": chunk_count,
                "memory_counts": memory_counts,
                "graph_edge_count": edge_counts.get(artifact.artifact_id, 0),
                "signal_count": signal_counts.get(artifact.artifact_id, 0),
                "organization_path": organization_path,
                "retrieval_state": _retrieval_state(artifact, chunk_count),
                "trust_boundary": _trust_boundary(artifact),
                "coverage_notes": _coverage_notes(artifact, chunk_count, memory_total),
            }
        )

    review_counts = Counter(artifact.review_status for artifact in visible_artifacts)
    source_counts = Counter(artifact.source_type for artifact in visible_artifacts)
    roots = [
        {
            "node_id": "root:evidence-substrate",
            "label": "Evidence substrate",
            "node_type": "root",
            "status": f"{len(visible_artifacts)} visible artifacts",
            "description": "Uploaded and pasted source evidence, grouped by trust boundary and source type.",
            "children_count": len(visible_artifacts),
            "metadata": dict(source_counts),
        },
        {
            "node_id": "root:chunks",
            "label": "Chunk index",
            "node_type": "index",
            "status": f"{total_chunks} chunks",
            "description": "Ordered source slices that retrieval and memory extraction can cite.",
            "children_count": total_chunks,
            "metadata": {"retrieval_index": "artifact_chunks_fts"},
        },
        {
            "node_id": "root:memory-objects",
            "label": "Structured memory objects",
            "node_type": "memory_layer",
            "status": f"{total_memory} objects",
            "description": "Decisions, assumptions, constraints, outcomes, and commitments extracted from chunks.",
            "children_count": total_memory,
            "metadata": {memory_type: sum(counts.values()) for memory_type, counts in memory_counts_by_type.items()},
        },
        {
            "node_id": "root:signals-traces",
            "label": "Signals, traces, and audit",
            "node_type": "governance_layer",
            "status": f"{total_signals} active artifact signals",
            "description": "Contradictions, drift, next actions, query traces, and audit records generated from trusted evidence.",
            "children_count": total_signals,
            "metadata": dict(review_counts),
        },
    ]

    return {
        "workspace_id": user.workspace_id,
        "generated_at": datetime.utcnow(),
        "roots": roots,
        "artifacts": artifact_items,
        "database_blueprint": _database_blueprint(),
        "organization_guide": _organization_guide(),
    }


ORCHESTRATION_STAGE_CATALOG: list[dict[str, Any]] = [
    {
        "stage_key": "orchestrator_plan",
        "title": "Orchestrator plan",
        "agent_role": "orchestrator_llm",
        "purpose": "Classify the user intent into one fixed reasoning mode and decide which bounded evidence stages should run.",
        "inputs": ["query_text", "visible workspace boundary", "reasoning mode catalog"],
        "outputs": ["dominant query class", "stage plan", "route confidence"],
        "deterministic_gate": "Only one fixed MVP reasoning mode is accepted: lineage, contradiction, assumption drift, or next-action.",
        "authority_level": "proposal_only",
        "current_reflection": "route_decision query trace step",
        "status": "implemented_as_bounded_route_decision",
    },
    {
        "stage_key": "evidence_indexer",
        "title": "Evidence indexer",
        "agent_role": "evidence_substrate_agent",
        "purpose": "Organize permitted artifacts into source files, chunks, FTS rows, and coverage notes.",
        "inputs": ["artifacts", "artifact_chunks", "review/visibility filters"],
        "outputs": ["selected chunks", "omitted chunks", "retrieval gaps"],
        "deterministic_gate": "Permission and review filters run before evidence is exposed to reasoning or LLM wording.",
        "authority_level": "deterministic_gate",
        "current_reflection": "evidence_selection query trace step plus memory file-system endpoint",
        "status": "partially_implemented",
    },
    {
        "stage_key": "memory_extractor",
        "title": "Memory extractor",
        "agent_role": "memory_extraction_agent",
        "purpose": "Extract decisions, assumptions, constraints, outcomes, and commitments from chunks.",
        "inputs": ["artifact chunk", "schema-first extraction contract"],
        "outputs": ["typed memory objects", "confidence", "source chunk provenance"],
        "deterministic_gate": "Objects are persisted only with source artifact/chunk pointers and extraction metadata.",
        "authority_level": "bounded_write_with_provenance",
        "current_reflection": "ingestion extraction/persistence stages",
        "status": "implemented",
    },
    {
        "stage_key": "graph_linker",
        "title": "Knowledge graph linker",
        "agent_role": "graph_linking_agent",
        "purpose": "Connect extracted memory into graph nodes and evidence-backed edges.",
        "inputs": ["typed memory objects", "topic keys", "source evidence"],
        "outputs": ["graph nodes", "graph edges", "timeline links"],
        "deterministic_gate": "Edges must carry source evidence pointers and confidence.",
        "authority_level": "bounded_write_with_provenance",
        "current_reflection": "graph linking during ingestion",
        "status": "implemented_as_mvp_graph",
    },
    {
        "stage_key": "contradiction_interrogator",
        "title": "Contradiction interrogator",
        "agent_role": "contradiction_agent",
        "purpose": "Interrogate graph-linked claims for explicit conflict pairs and paired evidence.",
        "inputs": ["memory objects", "graph edges", "query focus"],
        "outputs": ["ranked contradiction pairs", "paired evidence"],
        "deterministic_gate": "Only explicit conflict pairs with visible evidence on both sides can be surfaced.",
        "authority_level": "deterministic_reasoning",
        "current_reflection": "contradiction query mode and persisted signals",
        "status": "implemented",
    },
    {
        "stage_key": "assumption_drift_interrogator",
        "title": "Assumption drift interrogator",
        "agent_role": "drift_agent",
        "purpose": "Find assumptions whose validity changed due to later evidence or signals.",
        "inputs": ["assumptions", "later signals", "query focus"],
        "outputs": ["stale assumptions", "validity notes", "supporting later evidence"],
        "deterministic_gate": "Drift requires a visible source assumption and visible later support.",
        "authority_level": "deterministic_reasoning",
        "current_reflection": "assumption drift query mode and persisted signals",
        "status": "implemented",
    },
    {
        "stage_key": "guidance_planner",
        "title": "Guidance planner",
        "agent_role": "next_action_agent",
        "purpose": "Compose next actions from contradictions, drift, and open commitments.",
        "inputs": ["ranked contradictions", "stale assumptions", "open commitments"],
        "outputs": ["recommended next actions", "uncertainty notes"],
        "deterministic_gate": "Recommendations must cite selected visible evidence or state uncertainty.",
        "authority_level": "deterministic_reasoning_then_optional_wording",
        "current_reflection": "next-action query mode and answer_composition trace step",
        "status": "implemented",
    },
    {
        "stage_key": "provenance_verifier",
        "title": "Provenance verifier",
        "agent_role": "verifier_agent",
        "purpose": "Reject any proposed answer, signal, or stage output that lacks evidence, permission clearance, or trace metadata.",
        "inputs": ["stage outputs", "selected evidence", "permissions", "review status"],
        "outputs": ["accepted output", "rejected output", "uncertainty notes"],
        "deterministic_gate": "No trusted output without source artifact/chunk provenance and permission/review clearance.",
        "authority_level": "final_gate",
        "current_reflection": "permission redaction, review filtering, query trace, and audit events",
        "status": "planned_as_explicit_stage",
    },
]


def build_orchestration_blueprint(db: Session, user: User) -> dict[str, Any]:
    if user.role == "Admin":
        trace_step_query = select(QueryTraceStep.step_kind, func.count()).where(QueryTraceStep.workspace_id == user.workspace_id)
        query_count_query = select(func.count()).select_from(QueryRun).where(QueryRun.workspace_id == user.workspace_id)
        signal_count_query = select(func.count()).select_from(Signal).where(Signal.workspace_id == user.workspace_id, Signal.status == "active")
        artifact_count_query = select(func.count()).select_from(Artifact).where(Artifact.workspace_id == user.workspace_id)
    else:
        visible_artifact_ids = [
            artifact.artifact_id
            for artifact in db.scalars(select(Artifact).where(Artifact.workspace_id == user.workspace_id)).all()
            if artifact.review_status != "rejected" and artifact_is_visible_to_user(db, artifact, user)
        ]
        visible_query_ids = select(QueryRun.query_run_id).where(QueryRun.workspace_id == user.workspace_id, QueryRun.created_by == user.user_id)
        trace_step_query = select(QueryTraceStep.step_kind, func.count()).where(
            QueryTraceStep.workspace_id == user.workspace_id,
            QueryTraceStep.query_run_id.in_(visible_query_ids),
        )
        query_count_query = select(func.count()).select_from(QueryRun).where(
            QueryRun.workspace_id == user.workspace_id,
            QueryRun.created_by == user.user_id,
        )
        signal_count_query = select(func.count()).select_from(Signal).where(
            Signal.workspace_id == user.workspace_id,
            Signal.status == "active",
            Signal.source_artifact_id.in_(visible_artifact_ids),
        )
        artifact_count_query = select(func.count()).select_from(Artifact).where(Artifact.artifact_id.in_(visible_artifact_ids))

    trace_counts = {
        str(step_kind): int(count)
        for step_kind, count in db.execute(
            trace_step_query.group_by(QueryTraceStep.step_kind)
        ).all()
    }
    query_count = int(db.scalar(query_count_query) or 0)
    signal_count = int(db.scalar(signal_count_query) or 0)
    artifact_count = int(db.scalar(artifact_count_query) or 0)

    return {
        "workspace_id": user.workspace_id,
        "generated_at": datetime.utcnow(),
        "execution_model": "bounded_stage_orchestration",
        "current_runtime_note": (
            "The current runtime is deterministic and single-process. This blueprint shows the safe contract for the requested "
            "orchestrator/sub-agent model: the orchestrator can divide work into bounded stages, but every stage output remains "
            "evidence-scoped and must pass deterministic provenance and permission gates."
        ),
        "stage_catalog": ORCHESTRATION_STAGE_CATALOG,
        "spawn_policy": [
            "Spawn bounded stages only after artifact visibility and review scope are known.",
            "Each sub-agent receives a typed context packet, not unrestricted database access.",
            "Each sub-agent returns structured findings plus cited artifact/chunk/memory IDs.",
            "The orchestrator can compare sub-agent outputs, but cannot promote unsupported claims to trusted memory.",
            "The provenance verifier is the final gate before answers, graph changes, or signals become visible.",
        ],
        "current_reflection": {
            "artifact_count": artifact_count,
            "query_run_count": query_count,
            "active_signal_count": signal_count,
            "trace_step_counts": trace_counts,
        },
    }
