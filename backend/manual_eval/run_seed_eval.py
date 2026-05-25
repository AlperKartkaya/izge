from __future__ import annotations

import json
import mimetypes
import os
from pathlib import Path
import sys
from typing import Any, cast
import uuid
import urllib.error
import urllib.request


BASE = os.environ.get("IZGE_EVAL_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
SEED_DIR = Path(__file__).resolve().parent / "product_roadmap_seed"
EXPECTED = json.loads((SEED_DIR / "expected_signals.json").read_text(encoding="utf-8"))
RESTRICTED_TITLE = "Restricted Demo Evidence"
RESTRICTED_MARKER = "SECRET_RESTRICTED_EVIDENCE_MARKER"


def request(path: str, *, method: str = "GET", data: bytes | None = None, headers: dict[str, str] | None = None) -> dict | list:
    req = urllib.request.Request(BASE + path, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"{method} {path} failed with HTTP {exc.code}: {detail}") from exc


def request_status(path: str, *, method: str = "GET", data: bytes | None = None, headers: dict[str, str] | None = None) -> tuple[int, str]:
    req = urllib.request.Request(BASE + path, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req) as response:
            return response.status, response.read().decode("utf-8", errors="ignore")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="ignore")


def expect_object(payload: dict | list, label: str) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise TypeError(f"Expected {label} to be an object.")
    return cast(dict[str, Any], payload)


def expect_list(payload: dict | list, label: str) -> list[dict[str, Any]]:
    if not isinstance(payload, list):
        raise TypeError(f"Expected {label} to be a list.")
    return [cast(dict[str, Any], item) for item in payload if isinstance(item, dict)]


def contains_all_fragments(value: str, fragments: list[str]) -> bool:
    lowered = value.lower()
    return all(fragment.lower() in lowered for fragment in fragments)


def contains_any_fragment(value: str, fragments: list[str]) -> bool:
    lowered = value.lower()
    return any(fragment.lower() in lowered for fragment in fragments)


def upload_seed(token: str) -> dict[str, dict[str, Any]]:
    headers = {"Authorization": f"Bearer {token}"}
    uploaded: dict[str, dict[str, Any]] = {}
    for path in sorted(SEED_DIR.glob("0*.md")):
        boundary = "----IzgeBoundary"
        content = path.read_bytes()
        parts: list[bytes] = []
        fields = {
            "title": path.stem.replace("_", " ").title(),
            "visibility_scope": "workspace",
            "permitted_user_ids": "",
        }
        for name, value in fields.items():
            parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode())
        mime = mimetypes.guess_type(path.name)[0] or "text/markdown"
        parts.append(
            (
                f"--{boundary}\r\n"
                f"Content-Disposition: form-data; name=\"file\"; filename=\"{path.name}\"\r\n"
                f"Content-Type: {mime}\r\n\r\n"
            ).encode()
            + content
            + b"\r\n"
        )
        parts.append(f"--{boundary}--\r\n".encode())
        body = b"".join(parts)
        artifact = expect_object(
            request(
                "/api/artifacts/upload",
                method="POST",
                data=body,
                headers={**headers, "Content-Type": f"multipart/form-data; boundary={boundary}"},
            ),
            f"artifact upload response for {path.name}",
        )
        request(
            "/api/ingestion/run",
            method="POST",
            data=json.dumps({"artifact_id": artifact["artifact_id"]}).encode(),
            headers={**headers, "Content-Type": "application/json"},
        )
        uploaded[path.name] = artifact
    return uploaded


def create_permission_regression_fixture(token: str) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    suffix = uuid.uuid4().hex[:10]
    member_email = f"demo-member-{suffix}@example.com"
    member_password = "member-demo-password"
    member = expect_object(
        request(
            "/api/users",
            method="POST",
            data=json.dumps(
                {
                    "display_name": "Demo Member",
                    "email": member_email,
                    "role": "Member",
                    "password": member_password,
                    "is_active": True,
                }
            ).encode(),
            headers=headers,
        ),
        "member creation response",
    )
    restricted_text = (
        "# Restricted launch note\n"
        "Date: 2026-05-01\n\n"
        "## Decision\n"
        f"We decided {RESTRICTED_MARKER} should remain visible only to administrators.\n\n"
        "## Assumption\n"
        "The confidential launch-risk memo should not appear in member evidence, traces, contradictions, or drift items.\n"
    )
    restricted_artifact = expect_object(
        request(
            "/api/artifacts/pasted-text",
            method="POST",
            data=json.dumps(
                {
                    "title": RESTRICTED_TITLE,
                    "text": restricted_text,
                    "visibility_scope": "restricted",
                    "permitted_user_ids": [],
                }
            ).encode(),
            headers=headers,
        ),
        "restricted pasted-text response",
    )
    request(
        "/api/ingestion/run",
        method="POST",
        data=json.dumps({"artifact_id": restricted_artifact["artifact_id"]}).encode(),
        headers=headers,
    )
    member_signin = expect_object(
        request(
            "/api/auth/sign-in",
            method="POST",
            data=json.dumps({"email": member_email, "password": member_password}).encode(),
            headers={"Content-Type": "application/json"},
        ),
        "member sign-in response",
    )
    return {
        "member": member,
        "member_token": member_signin["access_token"],
        "restricted_artifact": restricted_artifact,
    }


def payload_contains_forbidden_value(value: Any, *, restricted_artifact_id: str) -> bool:
    serialized = json.dumps(value, sort_keys=True, default=str)
    return any(forbidden in serialized for forbidden in (RESTRICTED_TITLE, RESTRICTED_MARKER, restricted_artifact_id))


def payload_contains_artifact_id(value: Any, artifact_id: str) -> bool:
    serialized = json.dumps(value, sort_keys=True, default=str)
    return artifact_id in serialized


def permission_regression_checks(admin_token: str) -> dict[str, Any]:
    fixture = create_permission_regression_fixture(admin_token)
    member_token = fixture["member_token"]
    restricted_artifact = fixture["restricted_artifact"]
    restricted_artifact_id = restricted_artifact["artifact_id"]
    member_headers = {"Authorization": f"Bearer {member_token}", "Content-Type": "application/json"}

    artifact_detail_status, _artifact_detail_body = request_status(
        f"/api/artifacts/{restricted_artifact_id}",
        headers={"Authorization": f"Bearer {member_token}"},
    )
    artifact_signals_status, _artifact_signals_body = request_status(
        f"/api/artifacts/{restricted_artifact_id}/signals",
        headers={"Authorization": f"Bearer {member_token}"},
    )
    member_artifacts = expect_list(request("/api/artifacts", headers={"Authorization": f"Bearer {member_token}"}), "member artifact list")
    result = expect_object(
        request(
            "/api/query",
            method="POST",
            data=json.dumps({"query_text": "What should the team do next about the onboarding launch plan?"}).encode(),
            headers=member_headers,
        ),
        "member query result",
    )
    trace = expect_object(
        request(
            f"/api/query/{result['query_run_id']}/trace",
            headers={"Authorization": f"Bearer {member_token}"},
        ),
        "member query trace",
    )
    member_next_actions = expect_list(request("/api/next-actions", headers={"Authorization": f"Bearer {member_token}"}), "member next actions")
    member_signals = expect_list(request("/api/signals", headers={"Authorization": f"Bearer {member_token}"}), "member persisted signals")
    member_filesystem = expect_object(
        request("/api/evidence-substrate/filesystem", headers={"Authorization": f"Bearer {member_token}"}),
        "member memory filesystem",
    )
    member_temporal_graph = expect_object(
        request("/api/graph/temporal?limit=80", headers={"Authorization": f"Bearer {member_token}"}),
        "member temporal graph",
    )
    member_orchestration = expect_object(
        request("/api/evidence-substrate/orchestration", headers={"Authorization": f"Bearer {member_token}"}),
        "member orchestration blueprint",
    )
    member_scenario = expect_object(
        request(
            "/api/scenario/impact",
            method="POST",
            data=json.dumps({"scenario_text": "launch risk memo onboarding timing", "limit": 5}).encode(),
            headers=member_headers,
        ),
        "member scenario impact",
    )
    admin_signals = expect_list(request("/api/signals", headers={"Authorization": f"Bearer {admin_token}"}), "admin persisted signals")
    restricted_signal = next((signal for signal in admin_signals if signal.get("source_artifact_id") == restricted_artifact_id), None)
    restricted_signal_detail_status = None
    if restricted_signal is not None:
        restricted_signal_detail_status, _restricted_signal_detail_body = request_status(
            f"/api/signals/{restricted_signal['signal_id']}",
            headers={"Authorization": f"Bearer {member_token}"},
        )

    visible_artifact_titles = {str(item.get("title")) for item in member_artifacts}
    forbidden_payloads = {
        "artifact_list": member_artifacts,
        "supporting_evidence": result.get("supporting_evidence", []),
        "supporting_nodes": result.get("supporting_nodes", []),
        "related_signals": result.get("related_signals", []),
        "contradictions": result.get("contradictions", []),
        "stale_assumptions": result.get("stale_assumptions", []),
        "trace": trace,
        "next_actions": member_next_actions,
        "signals": member_signals,
        "memory_filesystem": member_filesystem,
        "temporal_graph": member_temporal_graph,
        "orchestration": member_orchestration,
        "scenario_impact": member_scenario,
    }
    member_trace_counts = member_orchestration.get("current_reflection", {}).get("trace_step_counts", {})
    checks = {
        "restricted_artifact_detail_forbidden": artifact_detail_status == 403,
        "restricted_artifact_signals_forbidden": artifact_signals_status == 403,
        "restricted_artifact_hidden_from_list": RESTRICTED_TITLE not in visible_artifact_titles,
        "member_result_permission_limited": result.get("permissions_limited") is True,
        "member_result_has_permission_caveat": any("permission" in str(note).lower() for note in result.get("uncertainty_notes", [])),
        "supporting_evidence_redacted": not payload_contains_forbidden_value(
            forbidden_payloads["supporting_evidence"], restricted_artifact_id=restricted_artifact_id
        ),
        "supporting_nodes_redacted": not payload_contains_forbidden_value(
            forbidden_payloads["supporting_nodes"], restricted_artifact_id=restricted_artifact_id
        ),
        "related_signals_redacted": not payload_contains_forbidden_value(
            forbidden_payloads["related_signals"], restricted_artifact_id=restricted_artifact_id
        ),
        "contradictions_redacted": not payload_contains_forbidden_value(
            forbidden_payloads["contradictions"], restricted_artifact_id=restricted_artifact_id
        ),
        "assumption_drift_redacted": not payload_contains_forbidden_value(
            forbidden_payloads["stale_assumptions"], restricted_artifact_id=restricted_artifact_id
        ),
        "trace_redacted": not payload_contains_forbidden_value(forbidden_payloads["trace"], restricted_artifact_id=restricted_artifact_id),
        "next_actions_redacted": not payload_contains_forbidden_value(
            forbidden_payloads["next_actions"], restricted_artifact_id=restricted_artifact_id
        ),
        "signals_redacted": not payload_contains_forbidden_value(
            forbidden_payloads["signals"], restricted_artifact_id=restricted_artifact_id
        ),
        "restricted_signal_detail_hidden": restricted_signal_detail_status in (None, 404),
        "artifact_list_redacted": not payload_contains_forbidden_value(
            forbidden_payloads["artifact_list"], restricted_artifact_id=restricted_artifact_id
        ),
        "memory_filesystem_redacted": not payload_contains_forbidden_value(
            forbidden_payloads["memory_filesystem"], restricted_artifact_id=restricted_artifact_id
        ),
        "temporal_graph_redacted": not payload_contains_forbidden_value(
            forbidden_payloads["temporal_graph"], restricted_artifact_id=restricted_artifact_id
        ),
        "scenario_impact_redacted": not payload_contains_forbidden_value(
            forbidden_payloads["scenario_impact"], restricted_artifact_id=restricted_artifact_id
        ),
        "orchestration_redacted": not payload_contains_forbidden_value(
            forbidden_payloads["orchestration"], restricted_artifact_id=restricted_artifact_id
        ),
        "orchestration_member_query_scoped": member_orchestration.get("current_reflection", {}).get("query_run_count") == 1,
        "orchestration_member_trace_scoped": sum(int(count) for count in member_trace_counts.values()) == len(trace.get("steps", [])),
    }
    return {
        "restricted_artifact_id": restricted_artifact_id,
        "member_user_id": fixture["member"]["user_id"],
        "checks": checks,
        "member_result_query_class": result.get("query_class"),
        "member_uncertainty_notes": result.get("uncertainty_notes", []),
    }


def collect_failures(report: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    for result in report["results"]:
        for check_name, passed in result["checks"].items():
            if not passed:
                failures.append(f"query:{result['name']}:{check_name}")
    for section_name, section in report["standalone"].items():
        for check_name, passed in section["checks"].items():
            if not passed:
                failures.append(f"standalone:{section_name}:{check_name}")
    for check_name, passed in report["permission_regression"]["checks"].items():
        if not passed:
            failures.append(f"permission:{check_name}")
    return failures


def run_eval() -> dict[str, Any]:
    signin = expect_object(
        request(
            "/api/auth/sign-in",
            method="POST",
            data=json.dumps({"email": "admin@example.com", "password": "change-me-admin"}).encode(),
            headers={"Content-Type": "application/json"},
        ),
        "sign-in response",
    )
    token = signin["access_token"]
    uploaded_artifacts = upload_seed(token)
    auth_headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    contradiction_list = expect_list(request("/api/contradictions", headers={"Authorization": f"Bearer {token}"}), "contradictions")
    drift_list = expect_list(request("/api/assumptions/stale", headers={"Authorization": f"Bearer {token}"}), "assumption drift")
    next_action_list = expect_list(request("/api/next-actions", headers={"Authorization": f"Bearer {token}"}), "next actions")
    persisted_signal_list = expect_list(request("/api/signals", headers={"Authorization": f"Bearer {token}"}), "persisted signals")
    preferred_signal = next((signal for signal in persisted_signal_list if signal.get("signal_type") == "next_action"), None)
    signal_for_detail = preferred_signal or (persisted_signal_list[0] if persisted_signal_list else None)
    signal_detail = (
        expect_object(
            request(f"/api/signals/{signal_for_detail['signal_id']}", headers={"Authorization": f"Bearer {token}"}),
            "persisted signal detail",
        )
        if signal_for_detail is not None
        else {}
    )
    graph_summary = expect_object(request("/api/graph/summary", headers={"Authorization": f"Bearer {token}"}), "graph summary")
    reversal_artifact = next(artifact for filename, artifact in uploaded_artifacts.items() if filename.startswith("03_"))
    checkpoint_artifact = next(artifact for filename, artifact in uploaded_artifacts.items() if filename.startswith("04_"))
    checkpoint_artifact_detail_before_review = expect_object(
        request(f"/api/artifacts/{checkpoint_artifact['artifact_id']}", headers={"Authorization": f"Bearer {token}"}),
        "checkpoint artifact detail before review",
    )
    checkpoint_artifact_reviewed = expect_object(
        request(
            f"/api/artifacts/{checkpoint_artifact['artifact_id']}/review",
            method="PATCH",
            data=json.dumps(
                {
                    "review_status": "reviewed",
                    "review_notes": "Seed eval: reviewed as trusted demo memory.",
                }
            ).encode(),
            headers=auth_headers,
        ),
        "checkpoint artifact review update",
    )
    audit_events = expect_list(request("/api/audit/events", headers={"Authorization": f"Bearer {token}"}), "audit events")
    reversal_signals = expect_object(
        request(f"/api/artifacts/{reversal_artifact['artifact_id']}/signals", headers={"Authorization": f"Bearer {token}"}),
        "reversal artifact signals",
    )
    checkpoint_signals = expect_object(
        request(f"/api/artifacts/{checkpoint_artifact['artifact_id']}/signals", headers={"Authorization": f"Bearer {token}"}),
        "checkpoint artifact signals",
    )
    permission_regression = permission_regression_checks(token)

    results = []
    for spec in EXPECTED["queries"]:
        result = expect_object(
            request("/api/query", method="POST", data=json.dumps({"query_text": spec["query"]}).encode(), headers=auth_headers),
            f"query result for {spec['name']}",
        )
        trace = expect_object(
            request(f"/api/query/{result['query_run_id']}/trace", headers={"Authorization": f"Bearer {token}"}),
            f"query trace for {spec['name']}",
        )
        trace_steps = trace.get("steps", [])
        trace_step_by_kind = {
            str(step.get("step_kind")): step.get("payload", {})
            for step in trace_steps
            if isinstance(step, dict)
        }
        orchestration_stages = {
            str(stage.get("stage_key")): str(stage.get("status"))
            for stage in trace_step_by_kind.get("bounded_orchestration", {}).get("stages", [])
            if isinstance(stage, dict)
        }
        query_class = result["query_class"]
        expected_contradiction_status = {"completed", "completed_empty"} if query_class in {"Contradiction analysis", "Next-action guidance"} else {"skipped"}
        expected_drift_status = {"completed", "completed_empty"} if query_class in {"Assumption drift", "Next-action guidance"} else {"skipped"}
        expected_guidance_status = {"completed", "completed_empty"} if query_class == "Next-action guidance" else {"skipped"}
        context_assembly_payload = trace_step_by_kind.get("context_assembly", {})
        contradiction_top = result.get("contradictions", [{}])[0] if result.get("contradictions") else {}
        drift_top = result.get("stale_assumptions", [{}])[0] if result.get("stale_assumptions") else {}
        top_item = contradiction_top if spec["name"] == "contradiction" else drift_top
        top_from_evidence = contradiction_top.get("from_evidence", {}) if isinstance(contradiction_top, dict) else {}
        top_to_evidence = contradiction_top.get("to_evidence", {}) if isinstance(contradiction_top, dict) else {}
        checks = {
            "query_class": result["query_class"] == spec["expected_query_class"],
            "answer_contains": all(
                fragment in result["answer_text"] or any(fragment in action for action in result.get("recommended_next_actions", []))
                for fragment in spec.get("expected_answer_contains", spec.get("expected_actions_contains", []))
            ),
            "supporting_memory_types": all(
                any(node["memory_type"] == expected for node in result.get("supporting_nodes", []))
                for expected in spec.get("expected_supporting_memory_types", [])
            ),
            "topic_key": spec.get("expected_topic_key") is None or all(
                token in str(contradiction_top.get("topic_key", "")) for token in str(spec["expected_topic_key"]).split()
            ),
            "statuses": not spec.get("expected_statuses") or any(item.get("status") in spec["expected_statuses"] for item in result.get("stale_assumptions", [])),
            "relation_types": not spec.get("expected_top_relation_types") or [contradiction_top.get("from_type"), contradiction_top.get("to_type")] in spec["expected_top_relation_types"],
            "top_evidence_precision": not spec.get("expected_top_evidence_contains") or contains_any_fragment(
                str(top_item.get("evidence_span", "")),
                cast(list[str], spec["expected_top_evidence_contains"]),
            ),
            "top_provenance_precision": not spec.get("expected_top_provenance_contains") or contains_all_fragments(
                str(top_item.get("evidence_provenance", "")),
                cast(list[str], spec["expected_top_provenance_contains"]),
            ),
            "paired_contradiction_evidence": spec["name"] != "contradiction" or (
                (not spec.get("expected_top_from_evidence_contains") or contains_any_fragment(
                    str(top_from_evidence.get("excerpt", "")),
                    cast(list[str], spec["expected_top_from_evidence_contains"]),
                ))
                and (not spec.get("expected_top_to_evidence_contains") or contains_any_fragment(
                    str(top_to_evidence.get("excerpt", "")),
                    cast(list[str], spec["expected_top_to_evidence_contains"]),
                ))
                and (spec.get("expected_top_from_artifact_title") is None or str(top_from_evidence.get("artifact_title", "")) == spec["expected_top_from_artifact_title"])
                and (spec.get("expected_top_to_artifact_title") is None or str(top_to_evidence.get("artifact_title", "")) == spec["expected_top_to_artifact_title"])
            ),
            "supporting_commitment_due_dates": not spec.get("expected_supporting_commitment_due_dates") or any(
                node.get("memory_type") == "commitment"
                and contains_any_fragment(str(node.get("due_date", "")), cast(list[str], spec["expected_supporting_commitment_due_dates"]))
                for node in result.get("supporting_nodes", [])
            ),
            "has_related_persisted_signals": bool(result.get("related_signals")),
            "supporting_evidence_has_review_status": all(
                isinstance(item.get("artifact_review_status"), str) and item.get("artifact_review_status")
                for item in result.get("supporting_evidence", [])
            ),
            "supporting_nodes_have_review_status": all(
                isinstance(item.get("source_artifact_review_status"), str) and item.get("source_artifact_review_status")
                for item in result.get("supporting_nodes", [])
            ),
            "trace_has_context_assembly": "context_assembly" in trace_step_by_kind,
            "trace_has_bounded_orchestration": "bounded_orchestration" in trace_step_by_kind,
            "trace_stage_statuses_truthful": (
                orchestration_stages.get("contradiction_interrogator") in expected_contradiction_status
                and orchestration_stages.get("assumption_drift_interrogator") in expected_drift_status
                and orchestration_stages.get("guidance_planner") in expected_guidance_status
            ),
            "trace_context_has_permission_filter": isinstance(context_assembly_payload.get("permission_filter"), dict),
            "trace_context_has_retrieval_recipe": bool(context_assembly_payload.get("retrieval_recipe")),
            "trace_omits_raw_source_paths": "source_path" not in json.dumps(trace, sort_keys=True, default=str),
        }
        results.append(
            {
                "name": spec["name"],
                "checks": checks,
                "query_class": result["query_class"],
                "top_answer": result["answer_text"],
                "top_evidence_span": top_item.get("evidence_span"),
                "top_evidence_provenance": top_item.get("evidence_provenance"),
                "top_from_evidence": top_from_evidence,
                "top_to_evidence": top_to_evidence,
            }
        )

    memory_filesystem = expect_object(
        request("/api/evidence-substrate/filesystem", headers={"Authorization": f"Bearer {token}"}),
        "memory filesystem",
    )
    orchestration_blueprint = expect_object(
        request("/api/evidence-substrate/orchestration", headers={"Authorization": f"Bearer {token}"}),
        "orchestration blueprint",
    )
    temporal_graph = expect_object(
        request("/api/graph/temporal?limit=120", headers={"Authorization": f"Bearer {token}"}),
        "temporal graph",
    )
    scenario_impact = expect_object(
        request(
            "/api/scenario/impact",
            method="POST",
            data=json.dumps(
                {
                    "scenario_text": "enterprise expansion self-serve onboarding launch security approval activation risk",
                    "limit": 8,
                }
            ).encode(),
            headers=auth_headers,
        ),
        "scenario impact",
    )
    filesystem_artifacts = memory_filesystem.get("artifacts", [])
    filesystem_text = json.dumps(memory_filesystem, sort_keys=True, default=str)
    trace_step_counts = orchestration_blueprint.get("current_reflection", {}).get("trace_step_counts", {})
    temporal_occurrences = temporal_graph.get("occurrences", [])
    temporal_links = temporal_graph.get("links", [])
    scenario_items = scenario_impact.get("impacted_memory", [])

    standalone = {
        "memory_filesystem": {
            "artifact_count": len(filesystem_artifacts),
            "root_count": len(memory_filesystem.get("roots", [])),
            "checks": {
                "has_memory_roots": len(memory_filesystem.get("roots", [])) >= 4,
                "has_seed_artifacts": len(filesystem_artifacts) >= len(uploaded_artifacts),
                "has_database_blueprint": len(memory_filesystem.get("database_blueprint", [])) >= 5,
                "has_organization_guide": len(memory_filesystem.get("organization_guide", [])) >= 6,
                "artifacts_have_safe_logical_locators": all(
                    str(artifact.get("storage_locator", "")).startswith("artifact://") for artifact in filesystem_artifacts
                ),
                "artifacts_have_downstream_counts": all(
                    isinstance(artifact.get("chunk_count"), int) and isinstance(artifact.get("memory_counts"), dict)
                    for artifact in filesystem_artifacts
                ),
                "does_not_expose_raw_source_paths": "source_path" not in filesystem_text,
            },
        },
        "orchestration_blueprint": {
            "stage_count": len(orchestration_blueprint.get("stage_catalog", [])),
            "checks": {
                "uses_bounded_execution_model": orchestration_blueprint.get("execution_model") == "bounded_stage_orchestration",
                "has_expected_stage_catalog": len(orchestration_blueprint.get("stage_catalog", [])) >= 8,
                "has_provenance_verifier_stage": any(
                    stage.get("stage_key") == "provenance_verifier"
                    for stage in orchestration_blueprint.get("stage_catalog", [])
                    if isinstance(stage, dict)
                ),
                "has_spawn_policy": bool(orchestration_blueprint.get("spawn_policy")),
                "reflects_context_assembly_traces": int(trace_step_counts.get("context_assembly", 0)) >= len(EXPECTED["queries"]),
                "reflects_bounded_orchestration_traces": int(trace_step_counts.get("bounded_orchestration", 0)) >= len(EXPECTED["queries"]),
            },
        },
        "temporal_knowledge_graph": {
            "occurrence_count": len(temporal_occurrences),
            "link_count": len(temporal_links),
            "checks": {
                "has_occurrences": bool(temporal_occurrences),
                "has_evidence_backed_links": bool(temporal_links)
                and all(link.get("evidence_artifact_id") and link.get("evidence_chunk_id") for link in temporal_links),
                "occurrences_have_status": all(bool(occurrence.get("status")) for occurrence in temporal_occurrences),
                "occurrences_have_claim_family": all(bool(occurrence.get("claim_family_key")) for occurrence in temporal_occurrences),
                "links_reference_visible_occurrences": {
                    link.get("from_occurrence_id")
                    for link in temporal_links
                }.issubset({occurrence.get("occurrence_id") for occurrence in temporal_occurrences})
                and {
                    link.get("to_occurrence_id")
                    for link in temporal_links
                }.issubset({occurrence.get("occurrence_id") for occurrence in temporal_occurrences}),
                "does_not_expose_raw_source_paths": "source_path" not in json.dumps(temporal_graph, sort_keys=True, default=str),
            },
        },
        "bounded_scenario_support": {
            "impact_count": len(scenario_items),
            "checks": {
                "finds_evidence_backed_impacts": bool(scenario_items),
                "items_have_memory_and_source_refs": all(
                    item.get("memory_type") and item.get("memory_id") and item.get("source_artifact_id")
                    for item in scenario_items
                ),
                "items_have_evidence_excerpt": all(bool(item.get("evidence_excerpt")) for item in scenario_items),
                "answer_is_bounded_not_forecast": any(
                    "bounded scenario support" in str(note).lower() and "not an unsupported forecast" in str(note).lower()
                    for note in scenario_impact.get("uncertainty_notes", [])
                ),
                "recommends_followup_questions": len(scenario_impact.get("recommended_questions", [])) >= 3,
            },
        },
        "contradictions": {
            "count": len(contradiction_list),
            "top_pair": f"{contradiction_list[0].get('from_title')} -> {contradiction_list[0].get('to_title')}" if contradiction_list else None,
            "checks": {
                "non_empty": bool(contradiction_list),
                "has_topic_context": bool(contradiction_list and contradiction_list[0].get("topic_key")),
                "has_ranking_basis": bool(contradiction_list and contradiction_list[0].get("ranking_basis")),
                "has_pair_context": bool(contradiction_list and contradiction_list[0].get("from_type") and contradiction_list[0].get("to_type")),
                "has_evidence_provenance": bool(contradiction_list and contradiction_list[0].get("evidence_provenance")),
            },
        },
        "assumption_drift": {
            "count": len(drift_list),
            "top_item": drift_list[0].get("title_or_label") if drift_list else None,
            "checks": {
                "non_empty": bool(drift_list),
                "has_topic_context": bool(drift_list and drift_list[0].get("topic_key")),
                "has_supporting_signal": bool(drift_list and drift_list[0].get("supporting_signal_title")),
                "has_evidence_provenance": bool(drift_list and drift_list[0].get("evidence_provenance")),
                "has_ranking_basis": bool(drift_list and drift_list[0].get("ranking_basis")),
            },
        },
        "next_actions": {
            "count": len(next_action_list),
            "top_item": next_action_list[0].get("title") if next_action_list else None,
            "checks": {
                "non_empty": bool(next_action_list),
                "has_recommended_action": bool(next_action_list and next_action_list[0].get("recommended_action")),
                "has_grounded_reasoning": bool(next_action_list and next_action_list[0].get("grounded_reasoning")),
                "has_supporting_memory": bool(next_action_list and next_action_list[0].get("supporting_memory_objects")),
                "has_supporting_evidence": bool(next_action_list and next_action_list[0].get("supporting_evidence")),
                "has_priority_and_uncertainty": bool(
                    next_action_list
                    and isinstance(next_action_list[0].get("urgency_score"), (int, float))
                    and isinstance(next_action_list[0].get("uncertainty_score"), (int, float))
                ),
                "action_shape": bool(
                    next_action_list
                    and contains_any_fragment(
                        str(next_action_list[0].get("recommended_action", "")),
                        ["Resolve the conflict", "Revalidate the assumption", "Review the open commitment"],
                    )
                ),
            },
        },
        "artifact_reversal_proactive": {
            "artifact_id": reversal_artifact["artifact_id"],
            "summary": reversal_signals.get("summary"),
            "checks": {
                "summary_mentions_artifact_impact": contains_any_fragment(
                    str(reversal_signals.get("summary", "")),
                    ["contradiction signal", "supersession", "next-action"],
                ),
                "has_introduced_contradiction": bool(reversal_signals.get("introduced_contradictions")),
                "has_artifact_scoped_next_action": bool(reversal_signals.get("recommended_next_actions")),
                "has_prior_relevant_work": bool(reversal_signals.get("prior_relevant_work")),
                "next_action_has_evidence": bool(
                    reversal_signals.get("recommended_next_actions")
                    and reversal_signals["recommended_next_actions"][0].get("supporting_evidence")
                ),
                "has_persisted_signal_links": bool(reversal_signals.get("persisted_signals")),
            },
        },
        "artifact_checkpoint_proactive": {
            "artifact_id": checkpoint_artifact["artifact_id"],
            "summary": checkpoint_signals.get("summary"),
            "checks": {
                "summary_mentions_artifact_impact": contains_any_fragment(
                    str(checkpoint_signals.get("summary", "")),
                    ["assumption-drift signal", "next-action"],
                ),
                "has_revealed_drift": bool(checkpoint_signals.get("revealed_assumption_drift")),
                "has_prior_relevant_work": bool(checkpoint_signals.get("prior_relevant_work")),
                "has_artifact_scoped_next_action": bool(checkpoint_signals.get("recommended_next_actions")),
                "next_action_has_memory": bool(
                    checkpoint_signals.get("recommended_next_actions")
                    and checkpoint_signals["recommended_next_actions"][0].get("supporting_memory_objects")
                ),
                "has_persisted_signal_links": bool(checkpoint_signals.get("persisted_signals")),
            },
        },
        "artifact_review_governance": {
            "artifact_id": checkpoint_artifact["artifact_id"],
            "before_review": checkpoint_artifact_detail_before_review.get("review_status"),
            "after_review": checkpoint_artifact_reviewed.get("review_status"),
            "checks": {
                "ingested_artifact_needs_review": checkpoint_artifact_detail_before_review.get("review_status") == "needs_review",
                "admin_can_mark_reviewed": checkpoint_artifact_reviewed.get("review_status") == "reviewed",
                "review_notes_persist": checkpoint_artifact_reviewed.get("review_notes") == "Seed eval: reviewed as trusted demo memory.",
                "review_actor_recorded": bool(checkpoint_artifact_reviewed.get("reviewed_by")),
                "review_timestamp_recorded": bool(checkpoint_artifact_reviewed.get("reviewed_at")),
                "audit_has_artifact_review_update": any(event.get("event_type") == "ARTIFACT_REVIEW_UPDATED" for event in audit_events),
            },
        },
        "persisted_signals": {
            "signal_counts": graph_summary.get("signal_counts"),
            "list_count": len(persisted_signal_list),
            "detail_id": signal_detail.get("signal_id"),
            "checks": {
                "graph_summary_has_signal_counts": bool(graph_summary.get("signal_counts")),
                "signals_list_non_empty": bool(persisted_signal_list),
                "has_persisted_next_actions": int(graph_summary.get("signal_counts", {}).get("next_action", 0)) > 0,
                "has_persisted_continuity_overlap": int(graph_summary.get("signal_counts", {}).get("continuity_overlap", 0)) > 0,
                "has_persisted_contradiction_or_drift": (
                    int(graph_summary.get("signal_counts", {}).get("contradiction", 0))
                    + int(graph_summary.get("signal_counts", {}).get("assumption_drift", 0))
                )
                > 0,
                "detail_has_source_artifact": bool(signal_detail.get("source_artifact_id") and signal_detail.get("source_artifact_title")),
                "detail_has_grounded_reasoning": bool(signal_detail.get("grounded_reasoning")),
                "detail_has_supporting_context": bool(
                    signal_detail.get("supporting_evidence") or signal_detail.get("supporting_memory_objects")
                ),
                "detail_has_intelligence_path": bool(signal_detail.get("intelligence_path")),
                "detail_evidence_has_review_status": all(
                    isinstance(item.get("artifact_review_status"), str) and item.get("artifact_review_status")
                    for item in signal_detail.get("supporting_evidence", [])
                ),
                "detail_memory_has_review_status": all(
                    isinstance(item.get("source_artifact_review_status"), str) and item.get("source_artifact_review_status")
                    for item in signal_detail.get("supporting_memory_objects", [])
                ),
                "detail_payload_records_reasoning_boundary": (
                    signal_detail.get("payload_json", {}).get("reasoning_boundary", {}).get("signal_detection")
                    == "deterministic_graph_analysis"
                ),
                "detail_payload_records_llm_role": bool(
                    signal_detail.get("payload_json", {}).get("reasoning_boundary", {}).get("llm_role")
                ),
                "detail_names_inference_boundary": contains_any_fragment(
                    json.dumps(signal_detail.get("intelligence_path", []), sort_keys=True, default=str),
                    ["central company-controlled", "deterministic graph", "Signal was classified"],
                ),
                "audit_has_proactive_signal_generation": any(
                    event.get("event_type") == "PROACTIVE_SIGNALS_GENERATED" for event in audit_events
                ),
                "audit_records_persisted_signal_count": any(
                    event.get("event_type") == "PROACTIVE_SIGNALS_GENERATED"
                    and int(event.get("event_metadata", {}).get("persisted_signal_count", 0)) > 0
                    for event in audit_events
                ),
            },
        },
    }
    rejected_review = expect_object(
        request(
            f"/api/artifacts/{reversal_artifact['artifact_id']}/review",
            method="PATCH",
            data=json.dumps(
                {
                    "review_status": "rejected",
                    "review_notes": "Seed eval: rejected to verify trusted reasoning exclusion.",
                }
            ).encode(),
            headers=auth_headers,
        ),
        "reversal artifact rejected review update",
    )
    rejected_query = expect_object(
        request(
            "/api/query",
            method="POST",
            data=json.dumps({"query_text": "Does the self-serve onboarding launch plan conflict with prior history?"}).encode(),
            headers=auth_headers,
        ),
        "rejected artifact exclusion query",
    )
    rejected_signals = expect_object(
        request(f"/api/artifacts/{reversal_artifact['artifact_id']}/signals", headers={"Authorization": f"Bearer {token}"}),
        "rejected artifact proactive signals",
    )
    signals_after_rejection = expect_list(request("/api/signals", headers={"Authorization": f"Bearer {token}"}), "signals after rejection")
    standalone["artifact_review_rejection_trust_boundary"] = {
        "artifact_id": reversal_artifact["artifact_id"],
        "review_status": rejected_review.get("review_status"),
        "summary": rejected_signals.get("summary"),
        "checks": {
            "admin_can_mark_rejected": rejected_review.get("review_status") == "rejected",
            "query_excludes_rejected_artifact": not payload_contains_artifact_id(
                {
                    "supporting_nodes": rejected_query.get("supporting_nodes", []),
                    "supporting_evidence": rejected_query.get("supporting_evidence", []),
                    "contradictions": rejected_query.get("contradictions", []),
                    "stale_assumptions": rejected_query.get("stale_assumptions", []),
                    "related_signals": rejected_query.get("related_signals", []),
                },
                reversal_artifact["artifact_id"],
            ),
            "query_names_rejected_evidence_boundary": any("rejected" in str(note).lower() for note in rejected_query.get("uncertainty_notes", [])),
            "artifact_signals_suppressed_when_rejected": sum(int(value) for value in rejected_signals.get("signal_counts", {}).values()) == 0,
            "artifact_signal_summary_names_rejection": "rejected" in str(rejected_signals.get("summary", "")).lower(),
            "persisted_signals_hide_rejected_source": all(
                signal.get("source_artifact_id") != reversal_artifact["artifact_id"] for signal in signals_after_rejection
            ),
        },
    }

    report = {
        "base_url": BASE,
        "results": results,
        "standalone": standalone,
        "permission_regression": permission_regression,
    }
    failures = collect_failures(report)
    total_checks = (
        sum(len(result["checks"]) for result in results)
        + sum(len(section["checks"]) for section in standalone.values())
        + len(permission_regression["checks"])
    )
    report["summary"] = {
        "total_checks": total_checks,
        "passed_checks": total_checks - len(failures),
        "failed_checks": len(failures),
        "failures": failures,
    }
    return report


def main() -> None:
    report = run_eval()
    print(json.dumps(report, indent=2))
    if report["summary"]["failed_checks"]:
        print(f"Seed eval failed: {report['summary']['failed_checks']} check(s) failed.", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
