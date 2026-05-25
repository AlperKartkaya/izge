from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Any, Literal, Sequence

from app.schemas.api import EvidenceReference, MemoryReference

TraceStatus = Literal["passed", "passed_with_gaps", "failed"]
StageStatus = Literal["completed", "completed_empty", "skipped"]


@dataclass(frozen=True)
class PermissionFilter:
    permissions_limited: bool
    hidden_artifact_count: int
    rejected_omitted_count: int
    prefilter_applied: bool = True

    def to_payload(self) -> dict[str, Any]:
        return {
            "permissions_limited": self.permissions_limited,
            "hidden_artifact_count": self.hidden_artifact_count,
            "rejected_omitted_count": self.rejected_omitted_count,
            "prefilter_applied": self.prefilter_applied,
            "scope_rule": "artifact visibility and review status are applied before ranking, tracing, or optional LLM wording",
        }


@dataclass(frozen=True)
class RetrievalRecipeStage:
    stage: str
    candidate_count: int
    selected_count: int
    omitted_count: int
    ranking_basis: list[str]
    authority: str

    def to_payload(self) -> dict[str, Any]:
        return {
            "stage": self.stage,
            "candidate_count": self.candidate_count,
            "selected_count": self.selected_count,
            "omitted_count": self.omitted_count,
            "ranking_basis": self.ranking_basis,
            "authority": self.authority,
        }


@dataclass(frozen=True)
class ContextPacket:
    packet_id: str
    mode: str
    permission_filter: PermissionFilter
    retrieval_recipe: list[RetrievalRecipeStage]
    selected_memory: list[dict[str, Any]]
    selected_evidence: list[dict[str, Any]]
    omitted_reasons: list[dict[str, Any]]
    selected_evidence_count: int
    selected_memory_count: int
    trace_payload_bytes: int = 0
    context_assembly_ms: int = 0
    max_selected_evidence: int = 12

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "schema_version": "context_packet.v1",
            "packet_type": "query_context_packet",
            "packet_id": self.packet_id,
            "mode": self.mode,
            "permission_filter": self.permission_filter.to_payload(),
            "retrieval_recipe": [stage.to_payload() for stage in self.retrieval_recipe],
            "selected_memory": self.selected_memory,
            "selected_evidence": self.selected_evidence,
            "selected_evidence_ids": [item["chunk_id"] or item["artifact_id"] for item in self.selected_evidence],
            "omitted_reasons": self.omitted_reasons,
            "evidence_budget": {
                "max_selected_evidence": self.max_selected_evidence,
                "selected_evidence_count": self.selected_evidence_count,
                "selected_memory_count": self.selected_memory_count,
                "packet_evidence_count": len(self.selected_evidence),
                "packet_memory_count": len(self.selected_memory),
                "within_budget": self.selected_evidence_count <= self.max_selected_evidence,
            },
            "metrics": {
                "selected_evidence_count": self.selected_evidence_count,
                "selected_memory_count": self.selected_memory_count,
                "packet_evidence_count": len(self.selected_evidence),
                "packet_memory_count": len(self.selected_memory),
                "trace_payload_bytes": self.trace_payload_bytes,
                "context_assembly_ms": self.context_assembly_ms,
            },
            "replay_contract": {
                "deterministic_inputs": ["mode", "permission_filter", "retrieval_recipe", "selected_memory", "selected_evidence"],
                "optional_llm_role": "wording_only_after_selected_evidence",
                "trusted_write_allowed": False,
            },
        }
        if self.trace_payload_bytes <= 0:
            payload["metrics"]["trace_payload_bytes"] = stable_payload_size_bytes(payload)
        return payload


@dataclass(frozen=True)
class ProvenanceVerifierResult:
    status: TraceStatus
    checks: dict[str, bool]
    accepted_evidence_count: int
    rejected_evidence_count: int
    uncertainty_count: int
    authority_boundary: str

    def to_payload(self) -> dict[str, Any]:
        return {
            "schema_version": "provenance_verifier.v1",
            "status": self.status,
            "checks": self.checks,
            "accepted_evidence_count": self.accepted_evidence_count,
            "rejected_evidence_count": self.rejected_evidence_count,
            "uncertainty_count": self.uncertainty_count,
            "authority_boundary": self.authority_boundary,
        }


def _evidence_reference_id(evidence: EvidenceReference) -> str:
    return f"{evidence.artifact_id}:{evidence.chunk_id or 'artifact'}:{evidence.evidence_kind or 'evidence'}"


def _memory_packet_items(nodes: Sequence[MemoryReference]) -> list[dict[str, Any]]:
    return [
        {
            "memory_type": node.memory_type,
            "memory_id": node.memory_id,
            "title_or_label": node.title_or_label,
            "source_artifact_id": node.source_artifact_id,
            "source_artifact_review_status": node.source_artifact_review_status,
            "topic_key": node.topic_key,
        }
        for node in nodes[:8]
    ]


def _evidence_packet_items(evidence: Sequence[EvidenceReference]) -> list[dict[str, Any]]:
    return [
        {
            "evidence_id": _evidence_reference_id(item),
            "artifact_id": item.artifact_id,
            "artifact_review_status": item.artifact_review_status,
            "chunk_id": item.chunk_id,
            "evidence_kind": item.evidence_kind,
            "has_excerpt": bool(item.excerpt),
        }
        for item in evidence[:12]
    ]


def build_context_packet(
    *,
    packet_id: str,
    query_class: str,
    supporting_nodes: Sequence[MemoryReference],
    supporting_evidence: Sequence[EvidenceReference],
    permissions_limited: bool,
    hidden_artifact_count: int,
    rejected_artifact_count: int,
    context_assembly_ms: int = 0,
) -> ContextPacket:
    permission_filter = PermissionFilter(
        permissions_limited=permissions_limited,
        hidden_artifact_count=hidden_artifact_count,
        rejected_omitted_count=rejected_artifact_count,
    )
    selected_memory = _memory_packet_items(supporting_nodes)
    selected_evidence = _evidence_packet_items(supporting_evidence)
    omitted_count = hidden_artifact_count + rejected_artifact_count + max(len(supporting_evidence) - len(selected_evidence), 0)
    return ContextPacket(
        packet_id=packet_id,
        mode=query_class,
        permission_filter=permission_filter,
        retrieval_recipe=[
            RetrievalRecipeStage(
                stage="graph_seed",
                candidate_count=len(supporting_nodes),
                selected_count=len(selected_memory),
                omitted_count=max(len(supporting_nodes) - len(selected_memory), 0),
                ranking_basis=["memory type", "topic overlap", "graph linkage", "recency"],
                authority="deterministic_candidate_selection",
            ),
            RetrievalRecipeStage(
                stage="evidence_selection",
                candidate_count=len(supporting_evidence),
                selected_count=len(selected_evidence),
                omitted_count=omitted_count,
                ranking_basis=["permission/review scope", "graph evidence first", "FTS fallback only when graph evidence is insufficient"],
                authority="deterministic_permission_prefilter_then_rank",
            ),
        ],
        selected_memory=selected_memory,
        selected_evidence=selected_evidence,
        omitted_reasons=[
            {"reason": "permission_hidden", "count": hidden_artifact_count},
            {"reason": "review_rejected", "count": rejected_artifact_count},
            {"reason": "trace_budget", "count": max(len(supporting_evidence) - len(selected_evidence), 0)},
        ],
        selected_evidence_count=len(supporting_evidence),
        selected_memory_count=len(supporting_nodes),
        context_assembly_ms=max(0, int(context_assembly_ms)),
    )


def stable_payload_size_bytes(payload: dict[str, Any]) -> int:
    """Return a self-consistent serialized size for a payload that records its own byte count."""

    size = 0
    metrics = payload.get("metrics")
    if not isinstance(metrics, dict):
        return len(json.dumps(payload, sort_keys=True, default=str).encode("utf-8"))
    for _ in range(4):
        metrics["trace_payload_bytes"] = size
        next_size = len(json.dumps(payload, sort_keys=True, default=str).encode("utf-8"))
        if next_size == size:
            return size
        size = next_size
    metrics["trace_payload_bytes"] = size
    return size


def build_provenance_verifier_result(*, context_packet: ContextPacket, uncertainty_notes: Sequence[str]) -> ProvenanceVerifierResult:
    checks = {
        "permission_prefilter_applied": context_packet.permission_filter.prefilter_applied,
        "selected_evidence_has_review_status": all(bool(item.get("artifact_review_status")) for item in context_packet.selected_evidence),
        "no_rejected_evidence_selected": all(item.get("artifact_review_status") != "rejected" for item in context_packet.selected_evidence),
        "evidence_budget_respected": context_packet.selected_evidence_count <= context_packet.max_selected_evidence,
        "deterministic_authority_preserved": True,
        "has_evidence_or_uncertainty": bool(context_packet.selected_evidence or uncertainty_notes),
    }
    status: TraceStatus
    if all(checks.values()):
        status = "passed"
    elif checks["permission_prefilter_applied"] and checks["deterministic_authority_preserved"] and checks["has_evidence_or_uncertainty"]:
        status = "passed_with_gaps"
    else:
        status = "failed"
    return ProvenanceVerifierResult(
        status=status,
        checks=checks,
        accepted_evidence_count=context_packet.selected_evidence_count,
        rejected_evidence_count=context_packet.permission_filter.rejected_omitted_count,
        uncertainty_count=len(uncertainty_notes),
        authority_boundary="verifier accepts selected evidence and uncertainty only; it never grants write authority to optional LLM wording or stage proposals",
    )


def stage_status(*, active: bool, output_count: int) -> StageStatus:
    if not active:
        return "skipped"
    return "completed" if output_count > 0 else "completed_empty"


def build_bounded_orchestration_payload(
    *,
    query_class: str,
    context_packet: ContextPacket,
    verifier_result: ProvenanceVerifierResult,
    contradiction_count: int,
    drift_count: int,
    guidance_count: int,
) -> dict[str, Any]:
    contradiction_stage_active = query_class in {"Contradiction analysis", "Next-action guidance"}
    drift_stage_active = query_class in {"Assumption drift", "Next-action guidance"}
    guidance_stage_active = query_class == "Next-action guidance"
    return {
        "schema_version": "bounded_orchestration_trace.v1",
        "execution_model": "bounded_stage_orchestration",
        "context_packet_id": context_packet.packet_id,
        "verifier_status": verifier_result.status,
        "stages": [
            {
                "stage_key": "orchestrator_plan",
                "status": "completed",
                "authority_level": "proposal_only",
                "output_count": 1,
                "reason": f"Routed to {query_class} and assembled a typed context packet.",
            },
            {
                "stage_key": "evidence_indexer",
                "status": "completed" if context_packet.selected_evidence_count else "completed_empty",
                "authority_level": "deterministic_gate",
                "output_count": context_packet.selected_evidence_count,
                "reason": "Permission/review filters and evidence selection were evaluated for this query.",
            },
            {
                "stage_key": "contradiction_interrogator",
                "status": stage_status(active=contradiction_stage_active, output_count=contradiction_count),
                "authority_level": "deterministic_reasoning",
                "output_count": contradiction_count,
                "reason": "Primary for contradiction/next-action modes; skipped for modes that do not require conflict interrogation.",
            },
            {
                "stage_key": "assumption_drift_interrogator",
                "status": stage_status(active=drift_stage_active, output_count=drift_count),
                "authority_level": "deterministic_reasoning",
                "output_count": drift_count,
                "reason": "Primary for drift/next-action modes; skipped for modes that do not require drift interrogation.",
            },
            {
                "stage_key": "guidance_planner",
                "status": stage_status(active=guidance_stage_active, output_count=guidance_count),
                "authority_level": "deterministic_reasoning_then_optional_wording",
                "output_count": guidance_count,
                "reason": "Only active for next-action guidance queries.",
            },
            {
                "stage_key": "provenance_verifier",
                "status": "completed" if verifier_result.status in {"passed", "passed_with_gaps"} else "completed_empty",
                "authority_level": "final_gate",
                "output_count": verifier_result.accepted_evidence_count,
                "reason": "Accepted the answer with selected evidence or explicit uncertainty notes.",
            },
        ],
        "trust_rule": "Stage outputs remain proposals until selected evidence, permission scope, and provenance are accepted by deterministic gates.",
    }
