from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import (
    Artifact,
    ArtifactChunk,
    Assumption,
    ClaimFamily,
    ClaimOccurrence,
    Commitment,
    Constraint,
    Decision,
    GraphEdge,
    OrchestrationJob,
    OrchestrationStageRun,
    Outcome,
    QueryRun,
    QueryTraceStep,
    ScenarioRun,
    Signal,
    User,
)
from app.services.llm_status import inspect_local_llm_status
from app.services.permissions import artifact_is_visible_to_user
from app.services.scenario_support import SCENARIO_TEMPLATES, TEMPLATE_CATALOG_VERSION

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
            "table_names": ["graph_nodes", "graph_edges", "claim_families", "claim_occurrences"],
            "purpose": "Typed links among memory objects plus time-aware claim families, claim occurrences, and source-backed conflict/supersession/continuity relationships.",
            "write_path": "Ingestion links extracted memory into graph nodes/edges, then syncs claim-family and claim-occurrence projections with validity windows.",
            "read_path": "Graph timeline, temporal graph, graph neighborhood, query support, signal generation.",
            "organization_rule": "Edges and temporal occurrences must remain evidence-backed; generated output never becomes a claim occurrence without source memory.",
        },
        {
            "layer": "5. Signals and traces",
            "table_names": ["signals", "query_runs", "query_trace_steps", "orchestration_stage_runs", "orchestration_jobs", "scenario_runs", "audit_events"],
            "purpose": "Durable proactive findings, query packets, orchestration trace, and governance audit.",
            "write_path": "Ingestion/query generates signals and trace events after deterministic evidence selection.",
            "read_path": "Dashboard, signal detail, query result trace, orchestration stage-run ledger, scenario replay history, audit page, orchestration page.",
            "organization_rule": "Every AI-assisted, scenario, or orchestration stage must leave a trace showing input evidence, proposed output, queue/worker state when async, and deterministic acceptance gate.",
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
        "status": "implemented",
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
        "current_reflection": "contradiction query mode, persisted signals, and bounded_parallel_subagent stage packets",
        "status": "implemented_as_parallel_stage_packet",
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
        "current_reflection": "assumption drift query mode, persisted signals, and bounded_parallel_subagent stage packets",
        "status": "implemented_as_parallel_stage_packet",
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
        "current_reflection": "next-action query mode, answer_composition trace step, and bounded_parallel_subagent stage packets",
        "status": "implemented_as_parallel_stage_packet",
    },
    {
        "stage_key": "worker_queue_dispatcher",
        "title": "DB-backed worker queue dispatcher",
        "agent_role": "orchestration_worker",
        "purpose": "Persist bounded stage tasks in a portable database queue so a local or deployed worker daemon can claim, lease, complete, fail, and replay work without losing the typed context boundary.",
        "inputs": ["typed stage payload", "workspace boundary", "lease policy"],
        "outputs": ["queued job", "claim lease", "terminal result"],
        "deterministic_gate": "Workers can only claim queued jobs from the current workspace and must return terminal status plus structured result/error metadata.",
        "authority_level": "bounded_async_execution",
        "current_reflection": "orchestration_jobs endpoint, app.worker daemon, Docker worker service, and migration-backed table",
        "status": "implemented_as_db_backed_worker_queue",
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
        "current_reflection": "provenance_verification query trace step plus permission redaction, review filtering, and audit events",
        "status": "implemented_as_explicit_trace_stage",
    },
]


def build_orchestration_blueprint(db: Session, user: User) -> dict[str, Any]:
    if user.role == "Admin":
        trace_step_query = select(QueryTraceStep.step_kind, func.count()).where(QueryTraceStep.workspace_id == user.workspace_id)
        stage_run_query = select(OrchestrationStageRun.stage_key, func.count()).where(OrchestrationStageRun.workspace_id == user.workspace_id)
        query_count_query = select(func.count()).select_from(QueryRun).where(QueryRun.workspace_id == user.workspace_id)
        signal_count_query = select(func.count()).select_from(Signal).where(Signal.workspace_id == user.workspace_id, Signal.status == "active")
        artifact_count_query = select(func.count()).select_from(Artifact).where(Artifact.workspace_id == user.workspace_id)
        job_count_query = select(func.count()).select_from(OrchestrationJob).where(OrchestrationJob.workspace_id == user.workspace_id)
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
        stage_run_query = select(OrchestrationStageRun.stage_key, func.count()).where(
            OrchestrationStageRun.workspace_id == user.workspace_id,
            OrchestrationStageRun.query_run_id.in_(visible_query_ids),
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
        job_count_query = select(func.count()).select_from(OrchestrationJob).where(
            OrchestrationJob.workspace_id == user.workspace_id,
            OrchestrationJob.created_by == user.user_id,
        )

    trace_counts = {
        str(step_kind): int(count)
        for step_kind, count in db.execute(
            trace_step_query.group_by(QueryTraceStep.step_kind)
        ).all()
    }
    stage_run_counts = {
        str(stage_key): int(count)
        for stage_key, count in db.execute(
            stage_run_query.group_by(OrchestrationStageRun.stage_key)
        ).all()
    }
    query_count = int(db.scalar(query_count_query) or 0)
    signal_count = int(db.scalar(signal_count_query) or 0)
    artifact_count = int(db.scalar(artifact_count_query) or 0)
    job_count = int(db.scalar(job_count_query) or 0)

    return {
        "workspace_id": user.workspace_id,
        "generated_at": datetime.utcnow(),
        "execution_model": "bounded_parallel_stage_orchestration",
        "current_runtime_note": (
            "The current runtime executes independent read-only specialist stage packets in a bounded local parallel pool after "
            "typed context assembly. This shows the orchestrator/sub-agent contract without granting unrestricted database "
            "authority: every packet remains evidence-scoped, queueable work has a lease/terminal result, and all output must pass deterministic provenance and permission gates."
        ),
        "stage_catalog": ORCHESTRATION_STAGE_CATALOG,
        "spawn_policy": [
            "Spawn bounded stages only after artifact visibility and review scope are known.",
            "Each sub-agent receives a typed context packet, not unrestricted database access.",
            "Only independent read-only stages may run concurrently; write-capable stages remain behind explicit provenance gates.",
            "Longer-running stages may be persisted as orchestration_jobs and claimed through a lease before any worker returns a terminal result.",
            "Each sub-agent returns structured findings plus cited artifact/chunk/memory IDs.",
            "The orchestrator can compare sub-agent outputs, but cannot promote unsupported claims to trusted memory.",
            "The provenance verifier is the final gate before answers, graph changes, or signals become visible.",
        ],
        "current_reflection": {
            "artifact_count": artifact_count,
            "query_run_count": query_count,
            "active_signal_count": signal_count,
            "trace_step_counts": trace_counts,
            "stage_run_count": sum(stage_run_counts.values()),
            "stage_run_counts": stage_run_counts,
            "orchestration_job_count": job_count,
            "stage_packet_trace_count": int(trace_counts.get("stage_packet_execution", 0)),
        },
    }


def list_orchestration_stage_runs(db: Session, user: User, *, query_run_id: str | None = None, limit: int = 80) -> dict[str, Any]:
    query = select(OrchestrationStageRun).where(OrchestrationStageRun.workspace_id == user.workspace_id)
    if query_run_id is not None:
        query = query.where(OrchestrationStageRun.query_run_id == query_run_id)

    if user.role != "Admin":
        visible_query_ids = select(QueryRun.query_run_id).where(
            QueryRun.workspace_id == user.workspace_id,
            QueryRun.created_by == user.user_id,
        )
        query = query.where(OrchestrationStageRun.query_run_id.in_(visible_query_ids))

    runs = db.scalars(query.order_by(OrchestrationStageRun.created_at.desc()).limit(limit)).all()
    return {
        "workspace_id": user.workspace_id,
        "generated_at": datetime.utcnow(),
        "query_run_id": query_run_id,
        "runs": runs,
    }


def _count_rows(db: Session, model: Any, *criteria: Any) -> int:
    return int(db.scalar(select(func.count()).select_from(model).where(*criteria)) or 0)


def _visible_artifacts_for_readiness(db: Session, user: User) -> list[Artifact]:
    artifacts = db.scalars(
        select(Artifact).where(Artifact.workspace_id == user.workspace_id).order_by(Artifact.created_at.desc())
    ).all()
    return [artifact for artifact in artifacts if artifact_is_visible_to_user(db, artifact, user)]


def _query_scope_counts(db: Session, user: User) -> dict[str, int]:
    if user.role == "Admin":
        query_count = _count_rows(db, QueryRun, QueryRun.workspace_id == user.workspace_id)
        trace_step_count = _count_rows(db, QueryTraceStep, QueryTraceStep.workspace_id == user.workspace_id)
        stage_run_count = _count_rows(db, OrchestrationStageRun, OrchestrationStageRun.workspace_id == user.workspace_id)
        context_packet_count = _count_rows(
            db,
            QueryTraceStep,
            QueryTraceStep.workspace_id == user.workspace_id,
            QueryTraceStep.step_kind == "context_assembly",
        )
        provenance_count = _count_rows(
            db,
            QueryTraceStep,
            QueryTraceStep.workspace_id == user.workspace_id,
            QueryTraceStep.step_kind == "provenance_verification",
        )
        orchestration_trace_count = _count_rows(
            db,
            QueryTraceStep,
            QueryTraceStep.workspace_id == user.workspace_id,
            QueryTraceStep.step_kind == "bounded_orchestration",
        )
        stage_packet_trace_count = _count_rows(
            db,
            QueryTraceStep,
            QueryTraceStep.workspace_id == user.workspace_id,
            QueryTraceStep.step_kind == "stage_packet_execution",
        )
        orchestration_job_count = _count_rows(db, OrchestrationJob, OrchestrationJob.workspace_id == user.workspace_id)
        return {
            "query_run_count": query_count,
            "trace_step_count": trace_step_count,
            "stage_run_count": stage_run_count,
            "context_packet_count": context_packet_count,
            "provenance_verification_count": provenance_count,
            "bounded_orchestration_trace_count": orchestration_trace_count,
            "stage_packet_trace_count": stage_packet_trace_count,
            "orchestration_job_count": orchestration_job_count,
        }

    scoped_query_ids = select(QueryRun.query_run_id).where(QueryRun.workspace_id == user.workspace_id, QueryRun.created_by == user.user_id).scalar_subquery()
    query_count = _count_rows(db, QueryRun, QueryRun.workspace_id == user.workspace_id, QueryRun.created_by == user.user_id)
    trace_step_count = _count_rows(
        db,
        QueryTraceStep,
        QueryTraceStep.workspace_id == user.workspace_id,
        QueryTraceStep.query_run_id.in_(scoped_query_ids),
    )
    stage_run_count = _count_rows(
        db,
        OrchestrationStageRun,
        OrchestrationStageRun.workspace_id == user.workspace_id,
        OrchestrationStageRun.query_run_id.in_(scoped_query_ids),
    )
    context_packet_count = _count_rows(
        db,
        QueryTraceStep,
        QueryTraceStep.workspace_id == user.workspace_id,
        QueryTraceStep.query_run_id.in_(scoped_query_ids),
        QueryTraceStep.step_kind == "context_assembly",
    )
    provenance_count = _count_rows(
        db,
        QueryTraceStep,
        QueryTraceStep.workspace_id == user.workspace_id,
        QueryTraceStep.query_run_id.in_(scoped_query_ids),
        QueryTraceStep.step_kind == "provenance_verification",
    )
    orchestration_trace_count = _count_rows(
        db,
        QueryTraceStep,
        QueryTraceStep.workspace_id == user.workspace_id,
        QueryTraceStep.query_run_id.in_(scoped_query_ids),
        QueryTraceStep.step_kind == "bounded_orchestration",
    )
    stage_packet_trace_count = _count_rows(
        db,
        QueryTraceStep,
        QueryTraceStep.workspace_id == user.workspace_id,
        QueryTraceStep.query_run_id.in_(scoped_query_ids),
        QueryTraceStep.step_kind == "stage_packet_execution",
    )
    orchestration_job_count = _count_rows(
        db,
        OrchestrationJob,
        OrchestrationJob.workspace_id == user.workspace_id,
        OrchestrationJob.created_by == user.user_id,
    )
    return {
        "query_run_count": query_count,
        "trace_step_count": trace_step_count,
        "stage_run_count": stage_run_count,
        "context_packet_count": context_packet_count,
        "provenance_verification_count": provenance_count,
        "bounded_orchestration_trace_count": orchestration_trace_count,
        "stage_packet_trace_count": stage_packet_trace_count,
        "orchestration_job_count": orchestration_job_count,
    }


def _workspace_snapshot(db: Session, user: User) -> dict[str, Any]:
    visible_artifacts = _visible_artifacts_for_readiness(db, user)
    usable_artifacts = [artifact for artifact in visible_artifacts if artifact.review_status != "rejected"]
    visible_artifact_ids = [artifact.artifact_id for artifact in visible_artifacts]
    usable_artifact_ids = [artifact.artifact_id for artifact in usable_artifacts]

    memory_counts = {
        memory_type: _count_rows(db, model, model.workspace_id == user.workspace_id, model.source_artifact_id.in_(usable_artifact_ids))
        for memory_type, model in MEMORY_MODELS
    }
    signal_criteria = [Signal.workspace_id == user.workspace_id, Signal.status == "active"]
    if user.role != "Admin":
        signal_criteria.append(Signal.source_artifact_id.in_(usable_artifact_ids))

    settings = get_settings()
    query_counts = _query_scope_counts(db, user)
    local_llm_feature_flags = {
        "extraction": settings.local_llm_enabled,
        "query_routing": settings.llm_query_routing_enabled,
        "answer_synthesis": settings.llm_answer_synthesis_enabled,
        "signal_explanation": settings.llm_signal_explanation_enabled,
    }
    enabled_llm_features = sum(1 for enabled in local_llm_feature_flags.values() if enabled)
    local_llm_gateway_status = "not_checked"
    local_llm_model_available = False
    local_llm_available_model_count = 0
    if enabled_llm_features:
        llm_status = inspect_local_llm_status()
        local_llm_gateway_status = str(llm_status.get("gateway_status") or "unknown")
        local_llm_model_available = bool(llm_status.get("configured_model_available"))
        local_llm_available_model_count = len(llm_status.get("available_models") or [])

    if user.role == "Admin":
        claim_occurrence_count = _count_rows(db, ClaimOccurrence, ClaimOccurrence.workspace_id == user.workspace_id)
        claim_family_count = _count_rows(db, ClaimFamily, ClaimFamily.workspace_id == user.workspace_id)
        scenario_run_count = _count_rows(db, ScenarioRun, ScenarioRun.workspace_id == user.workspace_id)
    else:
        claim_occurrence_count = _count_rows(
            db,
            ClaimOccurrence,
            ClaimOccurrence.workspace_id == user.workspace_id,
            ClaimOccurrence.source_artifact_id.in_(usable_artifact_ids),
        )
        claim_family_count = int(
            db.scalar(
                select(func.count(func.distinct(ClaimOccurrence.family_id))).where(
                    ClaimOccurrence.workspace_id == user.workspace_id,
                    ClaimOccurrence.source_artifact_id.in_(usable_artifact_ids),
                )
            )
            or 0
        )
        scenario_run_count = _count_rows(
            db,
            ScenarioRun,
            ScenarioRun.workspace_id == user.workspace_id,
            ScenarioRun.created_by == user.user_id,
        )

    return {
        "visible_artifact_count": len(visible_artifacts),
        "usable_artifact_count": len(usable_artifacts),
        "reviewed_artifact_count": sum(1 for artifact in visible_artifacts if artifact.review_status == "reviewed"),
        "pending_review_artifact_count": sum(1 for artifact in visible_artifacts if artifact.review_status in {"submitted", "needs_review"}),
        "rejected_artifact_count": sum(1 for artifact in visible_artifacts if artifact.review_status == "rejected"),
        "indexed_chunk_count": _count_rows(db, ArtifactChunk, ArtifactChunk.artifact_id.in_(usable_artifact_ids)),
        "memory_counts": memory_counts,
        "memory_object_count": sum(memory_counts.values()),
        "graph_edge_count": _count_rows(db, GraphEdge, GraphEdge.workspace_id == user.workspace_id, GraphEdge.evidence_artifact_id.in_(usable_artifact_ids)),
        "claim_family_count": claim_family_count,
        "claim_occurrence_count": claim_occurrence_count,
        "active_signal_count": _count_rows(db, Signal, *signal_criteria),
        "scenario_run_count": scenario_run_count,
        "scenario_template_count": len(SCENARIO_TEMPLATES),
        "scenario_template_catalog_version": TEMPLATE_CATALOG_VERSION,
        "local_llm_features_enabled": enabled_llm_features,
        "local_llm_feature_flags": local_llm_feature_flags,
        "local_llm_gateway_status": local_llm_gateway_status,
        "local_llm_configured_model_available": local_llm_model_available,
        "local_llm_available_model_count": local_llm_available_model_count,
        **query_counts,
    }


def _proof_signal(label: str, value: str | int | float | bool, route: str | None = None) -> dict[str, Any]:
    if isinstance(value, bool):
        rendered = "yes" if value else "no"
    else:
        rendered = str(value)
    return {"label": label, "value": rendered, "route": route}


def _score_counts(areas: list[dict[str, Any]]) -> dict[str, int]:
    counts: Counter[str] = Counter(str(area["status"]) for area in areas)
    return {status: counts.get(status, 0) for status in ("implemented", "partial", "planned")}


def build_target_readiness(db: Session, user: User) -> dict[str, Any]:
    snapshot = _workspace_snapshot(db, user)
    stage_count = len(ORCHESTRATION_STAGE_CATALOG)
    implemented_stage_count = sum(
        1 for stage in ORCHESTRATION_STAGE_CATALOG if str(stage.get("status", "")).startswith("implemented")
    )
    partial_stage_count = sum(
        1 for stage in ORCHESTRATION_STAGE_CATALOG if "partial" in str(stage.get("status", ""))
    )
    enabled_llm_features = int(snapshot["local_llm_features_enabled"])
    stage_packet_trace_count = int(snapshot["stage_packet_trace_count"])
    llm_gateway_status = str(snapshot["local_llm_gateway_status"])
    llm_ready = enabled_llm_features > 0 and llm_gateway_status == "ready" and bool(snapshot["local_llm_configured_model_available"])
    if llm_ready:
        local_llm_label = "ready"
    elif enabled_llm_features:
        local_llm_label = llm_gateway_status
    else:
        local_llm_label = "deterministic fallback"

    areas: list[dict[str, Any]] = [
        {
            "area_key": "evidence_substrate_fast_retrieval",
            "title": "Evidence substrate / fast retrieval foundation",
            "status": "implemented",
            "score": 0.92,
            "promise": "Artifacts enter as evidence roots, become ordered chunks, and are filtered by permissions and review state before retrieval or reasoning.",
            "demo_reflection": "The product exposes this as a memory file-system with safe artifact locators, checksums, chunk counts, memory coverage, trust boundaries, and organization guidance.",
            "evidence_routes": ["/api/evidence-substrate/filesystem", "/api/artifacts", "/api/ingestion/run"],
            "demo_surfaces": ["/memory-filesystem", "/artifacts", "/ingestion"],
            "proof_signals": [
                _proof_signal("Visible artifacts", snapshot["visible_artifact_count"], "/api/evidence-substrate/filesystem"),
                _proof_signal("Indexed chunks", snapshot["indexed_chunk_count"], "/api/evidence-substrate/filesystem"),
                _proof_signal("Usable artifacts", snapshot["usable_artifact_count"], "/api/artifacts"),
            ],
            "remaining_work": [
                "Add explicit chunk-neighbor traversal and latency/token budget metrics.",
                "Keep adding explicit Alembic revisions before any future table/column shape changes.",
            ],
            "risks": ["Retrieval is deterministic and inspectable, but not yet tuned against broad real-company corpora."],
        },
        {
            "area_key": "temporal_knowledge_graph",
            "title": "Temporal knowledge graph",
            "status": "implemented",
            "score": 0.9,
            "promise": "Decisions, assumptions, constraints, outcomes, and commitments should become time-aware claim occurrences with evidence-backed relationships.",
            "demo_reflection": "The current graph persists typed memory nodes, evidence-backed edges, claim-family rows, claim-occurrence rows, validity windows, and status transitions for temporal inspection.",
            "evidence_routes": ["/api/graph/summary", "/api/graph/temporal", "/api/graph/neighborhood/{memory_type}/{memory_id}"],
            "demo_surfaces": ["/graph", "/memory/:memoryType/:memoryId"],
            "proof_signals": [
                _proof_signal("Memory objects", snapshot["memory_object_count"], "/api/graph/summary"),
                _proof_signal("Graph edges", snapshot["graph_edge_count"], "/api/graph/summary"),
                _proof_signal("Claim families", snapshot["claim_family_count"], "/api/graph/temporal"),
                _proof_signal("Claim occurrences", snapshot["claim_occurrence_count"], "/api/graph/temporal"),
            ],
            "remaining_work": [
                "Add advanced temporal analytics for long-lived family drift and family-level confidence decay.",
                "Keep claim projection changes behind explicit Alembic revisions and migration smoke checks.",
            ],
            "risks": ["Claim families are a persisted projection over source memory rows; memory tables still remain the source of truth."],
        },
        {
            "area_key": "typed_context_assembly",
            "title": "Typed context assembly",
            "status": "implemented",
            "score": 0.88,
            "promise": "Answers should be assembled from typed memory objects, selected evidence, omitted reasons, permissions, review state, and uncertainty—not raw documents handed to an LLM.",
            "demo_reflection": "Query traces expose context_packet.v1, selected evidence, replay contracts, budget metrics, and provenance verification before answer composition.",
            "evidence_routes": ["/api/query", "/api/query/{query_run_id}/trace"],
            "demo_surfaces": ["/query", "/query/:queryRunId"],
            "proof_signals": [
                _proof_signal("Query runs", snapshot["query_run_count"], "/api/query"),
                _proof_signal("Context packets", snapshot["context_packet_count"], "/api/query/{query_run_id}/trace"),
                _proof_signal("Provenance verifier traces", snapshot["provenance_verification_count"], "/api/query/{query_run_id}/trace"),
            ],
            "remaining_work": [
                "Extract a shared ContextPacket schema used by query, scenario, and future stage packets.",
                "Add more packet-size and omission-reason regressions for large workspaces.",
            ],
            "risks": ["The packet contract is strong for current query/scenario surfaces, but not yet shared as a single schema module."],
        },
        {
            "area_key": "bounded_internal_orchestration",
            "title": "Bounded internal orchestration",
            "status": "implemented",
            "score": 0.89,
            "promise": "An orchestrator may divide work into specialist stages, but every stage must receive a typed context packet and return cited output through deterministic gates.",
            "demo_reflection": "The Orchestrate page shows a bounded stage catalog, spawn policy, current runtime boundary, persisted stage-run ledger, DB-backed job queue, worker lease/results, and stage_packet_execution traces from a bounded parallel sub-agent pool.",
            "evidence_routes": ["/api/evidence-substrate/orchestration", "/api/evidence-substrate/orchestration/runs"],
            "demo_surfaces": ["/orchestration", "/query/:queryRunId"],
            "proof_signals": [
                _proof_signal("Stage catalog", stage_count, "/api/evidence-substrate/orchestration"),
                _proof_signal("Implemented stages", implemented_stage_count, "/api/evidence-substrate/orchestration"),
                _proof_signal("Partial stages", partial_stage_count, "/api/evidence-substrate/orchestration"),
                _proof_signal("Persisted stage runs", snapshot["stage_run_count"], "/api/evidence-substrate/orchestration/runs"),
                _proof_signal("Stage packet traces", stage_packet_trace_count, "/api/query/{query_run_id}/trace"),
                _proof_signal("DB-backed orchestration jobs", snapshot["orchestration_job_count"], "/api/evidence-substrate/orchestration/jobs"),
            ],
            "remaining_work": [
                "Add production worker observability, retry/backoff policy, and dead-letter handling beyond the current bounded daemon.",
                "Add richer replay comparison for stage packets beyond the current safe output summaries.",
            ],
            "risks": ["The worker daemon is database-backed and portable; production hardening remains around metrics, autoscaling, and retry/dead-letter operations."],
        },
        {
            "area_key": "contradiction_drift_next_actions",
            "title": "Contradiction, assumption drift, and next-action intelligence",
            "status": "implemented",
            "score": 0.9,
            "promise": "Izge should surface contradictions, assumptions that decayed, supersession/continuity, and grounded next actions with evidence.",
            "demo_reflection": "Dashboard, Graph, Ingestion, Signal Detail, and Query Result surfaces all expose durable signal counts, evidence, memory refs, uncertainty, and recommended actions.",
            "evidence_routes": ["/api/contradictions", "/api/assumptions/stale", "/api/next-actions", "/api/signals"],
            "demo_surfaces": ["/", "/graph", "/signals/:signalId", "/ingestion"],
            "proof_signals": [
                _proof_signal("Active signals", snapshot["active_signal_count"], "/api/signals"),
                _proof_signal("Trace steps", snapshot["trace_step_count"], "/api/query/{query_run_id}/trace"),
                _proof_signal("Open commitments", snapshot["memory_counts"].get("commitment", 0), "/api/graph/summary"),
            ],
            "remaining_work": [
                "Add more real-company fixtures beyond the current product-roadmap seed.",
                "Keep evaluation focused on grounded answer quality, not generic analytics-card growth.",
            ],
            "risks": ["Signal quality is strongest where artifacts follow the current evidence structure and topic overlap conventions."],
        },
        {
            "area_key": "private_ai_evidence_discipline",
            "title": "Private AI assistance with evidence discipline",
            "status": "implemented" if llm_ready else "partial",
            "score": 0.88 if llm_ready else (0.72 if enabled_llm_features else 0.62),
            "promise": "Private/local inference may assist extraction, routing, wording, and signal explanation while deterministic graph logic remains the authority.",
            "demo_reflection": "The backend has feature flags, health/smoke endpoints, deterministic fallback, answer trace boundaries, and provenance verification so AI wording cannot become trusted memory by itself.",
            "evidence_routes": ["/api/system/llm-status", "/api/system/llm-smoke", "/api/query/{query_run_id}/trace"],
            "demo_surfaces": ["/admin", "/query/:queryRunId"],
            "proof_signals": [
                _proof_signal("LLM mode", local_llm_label, "/api/system/llm-status"),
                _proof_signal("Enabled AI feature flags", enabled_llm_features, "/api/system/llm-status"),
                _proof_signal("Configured model available", bool(snapshot["local_llm_configured_model_available"]), "/api/system/llm-status"),
                _proof_signal("Provenance verifier traces", snapshot["provenance_verification_count"], "/api/query/{query_run_id}/trace"),
            ],
            "remaining_work": [
                "Keep recording deployment-specific local/private LLM smoke evidence for every customer machine.",
                "Add answer-quality evaluator fixtures that compare meaningful responses against cited evidence.",
            ],
            "risks": ["If local LLM features are disabled or the model is absent, Izge remains deterministic but cannot show private inference assistance live."],
        },
        {
            "area_key": "demo_ui_storytelling",
            "title": "Customer operations UI",
            "status": "implemented",
            "score": 0.9,
            "promise": "The product workspace should make artifacts, memory organization, graph reasoning, orchestration jobs, evidence, database/storage inspection, and scenario support visible without marketing copy.",
            "demo_reflection": "Primary nav now covers Dashboard, Artifacts, Ingestion, Assistant, Graph, Memory FS, Jobs, Readiness, Data, Audit, and Users with a quieter operations layout.",
            "evidence_routes": [
                "/api/evidence-substrate/filesystem",
                "/api/graph/temporal",
                "/api/evidence-substrate/orchestration",
                "/api/scenario/impact",
                "/api/evidence-substrate/readiness",
            ],
            "demo_surfaces": ["/", "/artifacts", "/memory-filesystem", "/graph", "/orchestration", "/admin/data", "/readiness"],
            "proof_signals": [
                _proof_signal("Visible operations surfaces", 7, "/readiness"),
                _proof_signal("Scenario templates", snapshot["scenario_template_count"], "/api/scenario/templates"),
                _proof_signal("Target score route", "available", "/api/evidence-substrate/readiness"),
            ],
            "remaining_work": [
                "Add a one-click scripted customer workspace reset/import runbook that starts from clean seed data and records the path.",
                "Add per-company onboarding copy that separates operator setup from executive read-only review.",
            ],
            "risks": ["The UI is operational, but browser QA should remain part of every visible customer release pass."],
        },
        {
            "area_key": "bounded_scenario_support",
            "title": "Bounded scenario support",
            "status": "implemented",
            "score": 0.9,
            "promise": "Scenario questions should identify known assumptions, commitments, constraints, decisions, and outcomes needing review without fabricating forecasts.",
            "demo_reflection": "The Orchestrate page calls a template-guided impact endpoint, persists scenario packet runs, and can replay stored runs against current permissions/evidence for deterministic comparison.",
            "evidence_routes": ["/api/scenario/templates", "/api/scenario/impact", "/api/scenario/runs", "/api/scenario/runs/{scenario_run_id}/replay"],
            "demo_surfaces": ["/orchestration"],
            "proof_signals": [
                _proof_signal("Scenario templates", snapshot["scenario_template_count"], "/api/scenario/templates"),
                _proof_signal("Template catalog", snapshot["scenario_template_catalog_version"], "/api/scenario/templates"),
                _proof_signal("Scenario runs", snapshot["scenario_run_count"], "/api/scenario/runs"),
                _proof_signal("Forecasting allowed", "no", "/api/scenario/impact"),
            ],
            "remaining_work": [
                "Add more company-specific scenario lenses after the replay contract stays stable.",
                "Add longitudinal scenario-diff dashboards for high-volume workspaces.",
            ],
            "risks": ["This is impact lookup, not simulation; expansion should stay bounded to evidence-backed memory."],
        },
        {
            "area_key": "portable_runtime",
            "title": "Portable runtime for any company machine",
            "status": "implemented",
            "score": 0.86,
            "promise": "Docker Compose should start backend, frontend, persisted database/storage, and proxy on a clean company-controlled machine.",
            "demo_reflection": "The project includes Compose runtime, persisted volumes, seeded workspace identities, backup/restore scripts, Docker smoke evaluation, and an Ollama-backed smoke/eval script.",
            "evidence_routes": ["/health", "/api/evidence-substrate/readiness"],
            "demo_surfaces": ["Docker Compose runtime", "frontend proxy", "backend health"],
            "proof_signals": [
                _proof_signal("Portable smoke gate", "documented"),
                _proof_signal("Ollama smoke gate", "documented"),
                _proof_signal("Persisted workspace volume", "yes"),
                _proof_signal("Seeded workspace identities", "configured"),
            ],
            "remaining_work": [
                "Add CI automation around migration, Docker, synthetic-company, and Ollama smoke evals.",
                "Add HTTPS and stronger auth hardening guidance for production customer-controlled deployments.",
            ],
            "risks": ["Portable local runtime is implemented; production hardening still needs deployment-specific security work."],
        },
    ]

    target_score = round(sum(float(area["score"]) for area in areas) / len(areas), 4)
    return {
        "workspace_id": user.workspace_id,
        "generated_at": datetime.utcnow(),
        "schema_version": "target_readiness.v1",
        "target_score": target_score,
        "status_counts": _score_counts(areas),
        "current_workspace_snapshot": snapshot,
        "areas": areas,
        "next_best_passes": [
            "Add CI automation that runs deterministic seed eval, Docker smoke eval, and Ollama smoke eval when a model is available.",
            "Add more customer-corpus evaluator fixtures beyond the first synthetic company workflow, scoring answer usefulness against cited evidence.",
            "Add worker observability, retry/dead-letter policy, and CI worker smoke eval coverage around the DB-backed daemon.",
            "Promote the synthetic-company and worker workflow evals into CI next to deterministic seed, Docker, and Ollama gates.",
        ],
        "evaluator_gate": {
            "name": "company_portable_memory_system_seed_eval",
            "command": "cd backend && .venv/bin/python -m manual_eval.run_isolated_seed_eval && .venv/bin/python -m manual_eval.run_isolated_synthetic_company_workflow",
            "required_checks": [
                "readiness_endpoint_has_all_target_areas",
                "readiness_areas_have_evidence_routes_and_demo_surfaces",
                "readiness_omits_host_storage_locations",
                "readiness_tracks_remaining_work",
            ],
        },
    }
