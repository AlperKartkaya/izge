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


def upload_seed(token: str) -> None:
    headers = {"Authorization": f"Bearer {token}"}
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

    visible_artifact_titles = {str(item.get("title")) for item in member_artifacts}
    forbidden_payloads = {
        "artifact_list": member_artifacts,
        "supporting_evidence": result.get("supporting_evidence", []),
        "supporting_nodes": result.get("supporting_nodes", []),
        "contradictions": result.get("contradictions", []),
        "stale_assumptions": result.get("stale_assumptions", []),
        "trace": trace,
    }
    checks = {
        "restricted_artifact_detail_forbidden": artifact_detail_status == 403,
        "restricted_artifact_hidden_from_list": RESTRICTED_TITLE not in visible_artifact_titles,
        "member_result_permission_limited": result.get("permissions_limited") is True,
        "member_result_has_permission_caveat": any("permission" in str(note).lower() for note in result.get("uncertainty_notes", [])),
        "supporting_evidence_redacted": not payload_contains_forbidden_value(
            forbidden_payloads["supporting_evidence"], restricted_artifact_id=restricted_artifact_id
        ),
        "supporting_nodes_redacted": not payload_contains_forbidden_value(
            forbidden_payloads["supporting_nodes"], restricted_artifact_id=restricted_artifact_id
        ),
        "contradictions_redacted": not payload_contains_forbidden_value(
            forbidden_payloads["contradictions"], restricted_artifact_id=restricted_artifact_id
        ),
        "assumption_drift_redacted": not payload_contains_forbidden_value(
            forbidden_payloads["stale_assumptions"], restricted_artifact_id=restricted_artifact_id
        ),
        "trace_redacted": not payload_contains_forbidden_value(forbidden_payloads["trace"], restricted_artifact_id=restricted_artifact_id),
        "artifact_list_redacted": not payload_contains_forbidden_value(
            forbidden_payloads["artifact_list"], restricted_artifact_id=restricted_artifact_id
        ),
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
    upload_seed(token)
    auth_headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    contradiction_list = expect_list(request("/api/contradictions", headers={"Authorization": f"Bearer {token}"}), "contradictions")
    drift_list = expect_list(request("/api/assumptions/stale", headers={"Authorization": f"Bearer {token}"}), "assumption drift")
    permission_regression = permission_regression_checks(token)

    results = []
    for spec in EXPECTED["queries"]:
        result = expect_object(
            request("/api/query", method="POST", data=json.dumps({"query_text": spec["query"]}).encode(), headers=auth_headers),
            f"query result for {spec['name']}",
        )
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

    standalone = {
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
