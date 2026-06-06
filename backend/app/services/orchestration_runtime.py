from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from time import perf_counter
from typing import Any

from app.services.query_context import ContextPacket, ProvenanceVerifierResult, stage_status


def _iso_now() -> str:
    return datetime.now(UTC).isoformat()


def _stage_packet(
    *,
    stage_key: str,
    agent_role: str,
    query_class: str,
    context_packet: ContextPacket,
    verifier_result: ProvenanceVerifierResult,
    active: bool,
    output_count: int,
    reason: str,
    output_refs: list[str],
    execution_wave: int,
) -> dict[str, Any]:
    started_at = _iso_now()
    started = perf_counter()
    status = stage_status(active=active, output_count=output_count)
    duration_ms = max(1, int((perf_counter() - started) * 1000))
    return {
        "schema_version": "stage_packet.v1",
        "stage_packet_id": f"{context_packet.packet_id}:{stage_key}",
        "stage_key": stage_key,
        "agent_role": agent_role,
        "query_class": query_class,
        "execution_wave": execution_wave,
        "execution_model": "bounded_parallel_subagent",
        "status": status,
        "started_at": started_at,
        "completed_at": _iso_now(),
        "duration_ms": duration_ms,
        "input_contract": {
            "context_packet_id": context_packet.packet_id,
            "context_schema_version": "context_packet.v1",
            "allowed_inputs": ["selected_memory", "selected_evidence", "omitted_reasons", "permission_filter"],
            "permission_prefilter_applied": context_packet.permission_filter.prefilter_applied,
        },
        "output_contract": {
            "output_refs": output_refs,
            "output_count": output_count,
            "reason": reason,
            "trusted_write_allowed": False,
            "may_update_memory": False,
        },
        "provenance_gate": {
            "verifier_status": verifier_result.status,
            "accepted_evidence_count": verifier_result.accepted_evidence_count,
            "authority_boundary": verifier_result.authority_boundary,
        },
    }


def run_bounded_parallel_stage_packets(
    *,
    query_class: str,
    context_packet: ContextPacket,
    verifier_result: ProvenanceVerifierResult,
    contradiction_count: int,
    drift_count: int,
    guidance_count: int,
) -> dict[str, Any]:
    """Execute independent read-only stage workers concurrently behind the context/provenance gate."""

    contradiction_stage_active = query_class in {"Contradiction analysis", "Next-action guidance"}
    drift_stage_active = query_class in {"Assumption drift", "Next-action guidance"}
    guidance_stage_active = query_class == "Next-action guidance"
    worker_specs = [
        {
            "stage_key": "contradiction_interrogator",
            "agent_role": "contradiction-subagent",
            "active": contradiction_stage_active,
            "output_count": contradiction_count,
            "reason": "Inspected selected memory for conflict pairs inside the typed context packet.",
            "output_refs": ["contradictions"],
        },
        {
            "stage_key": "assumption_drift_interrogator",
            "agent_role": "drift-subagent",
            "active": drift_stage_active,
            "output_count": drift_count,
            "reason": "Inspected selected memory for stale, weakening, or reversed assumptions.",
            "output_refs": ["stale_assumptions"],
        },
        {
            "stage_key": "guidance_planner",
            "agent_role": "next-action-subagent",
            "active": guidance_stage_active,
            "output_count": guidance_count,
            "reason": "Proposed next actions from accepted contradiction, drift, and commitment support.",
            "output_refs": ["recommended_next_actions"],
        },
    ]

    started_at = _iso_now()
    started = perf_counter()
    packets: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=len(worker_specs), thread_name_prefix="izge-stage") as executor:
        futures = [
            executor.submit(
                _stage_packet,
                query_class=query_class,
                context_packet=context_packet,
                verifier_result=verifier_result,
                execution_wave=1,
                **spec,
            )
            for spec in worker_specs
        ]
        for future in as_completed(futures):
            packets.append(future.result())

    packets.sort(key=lambda item: item["stage_key"])
    completed_at = _iso_now()
    return {
        "schema_version": "bounded_stage_packet_execution.v1",
        "execution_model": "bounded_parallel_subagent_pool",
        "started_at": started_at,
        "completed_at": completed_at,
        "duration_ms": max(1, int((perf_counter() - started) * 1000)),
        "max_workers": len(worker_specs),
        "parallel_stage_keys": [spec["stage_key"] for spec in worker_specs],
        "context_packet_id": context_packet.packet_id,
        "verifier_status": verifier_result.status,
        "trusted_write_allowed": False,
        "packets": packets,
    }
