from __future__ import annotations

import json
import mimetypes
from pathlib import Path
import urllib.request


BASE = "http://127.0.0.1:8000"
SEED_DIR = Path(__file__).resolve().parent / "product_roadmap_seed"
EXPECTED = json.loads((SEED_DIR / "expected_signals.json").read_text(encoding="utf-8"))


def request(path: str, *, method: str = "GET", data: bytes | None = None, headers: dict[str, str] | None = None) -> dict | list:
    req = urllib.request.Request(BASE + path, data=data, headers=headers or {}, method=method)
    with urllib.request.urlopen(req) as response:
        return json.loads(response.read().decode())


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
        artifact = request(
            "/api/artifacts/upload",
            method="POST",
            data=body,
            headers={**headers, "Content-Type": f"multipart/form-data; boundary={boundary}"},
        )
        request(
            "/api/ingestion/run",
            method="POST",
            data=json.dumps({"artifact_id": artifact["artifact_id"]}).encode(),
            headers={**headers, "Content-Type": "application/json"},
        )


def main() -> None:
    signin = request(
        "/api/auth/sign-in",
        method="POST",
        data=json.dumps({"email": "admin@example.com", "password": "change-me-admin"}).encode(),
        headers={"Content-Type": "application/json"},
    )
    token = signin["access_token"]
    upload_seed(token)
    auth_headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    contradiction_list = request("/api/contradictions", headers={"Authorization": f"Bearer {token}"})
    drift_list = request("/api/assumptions/drift", headers={"Authorization": f"Bearer {token}"})

    results = []
    for spec in EXPECTED["queries"]:
        result = request("/api/query", method="POST", data=json.dumps({"query_text": spec["query"]}).encode(), headers=auth_headers)
        contradiction_top = result.get("contradictions", [{}])[0] if result.get("contradictions") else {}
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
        }
        results.append({"name": spec["name"], "checks": checks, "query_class": result["query_class"], "top_answer": result["answer_text"]})

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

    print(json.dumps({"results": results, "standalone": standalone}, indent=2))


if __name__ == "__main__":
    main()
