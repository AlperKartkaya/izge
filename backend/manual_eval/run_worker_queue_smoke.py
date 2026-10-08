from __future__ import annotations

from contextlib import closing
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from typing import Any, cast
import urllib.error
import urllib.request


def find_free_port() -> int:
    with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_for_health(base_url: str, *, timeout_seconds: float = 20.0) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{base_url}/health", timeout=1.0) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, TimeoutError) as exc:
            last_error = exc
        time.sleep(0.2)
    raise RuntimeError(f"Timed out waiting for isolated worker-smoke backend health at {base_url}: {last_error}")


def terminate_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def request(base_url: str, path: str, *, method: str = "GET", data: bytes | None = None, headers: dict[str, str] | None = None) -> dict | list:
    req = urllib.request.Request(base_url + path, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"{method} {path} failed with HTTP {exc.code}: {detail}") from exc


def expect_object(payload: dict | list, label: str) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise TypeError(f"Expected {label} to be an object.")
    return cast(dict[str, Any], payload)


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def sign_in(base_url: str) -> str:
    response = expect_object(
        request(
            base_url,
            "/api/auth/sign-in",
            method="POST",
            data=json.dumps({"email": "admin@example.com", "password": "change-me-admin"}).encode(),
            headers={"Content-Type": "application/json"},
        ),
        "sign in response",
    )
    return str(response["access_token"])


def create_job(base_url: str, token: str, *, trusted_write_allowed: bool = False) -> dict[str, Any]:
    return expect_object(
        request(
            base_url,
            "/api/evidence-substrate/orchestration/jobs",
            method="POST",
            data=json.dumps(
                {
                    "job_kind": "synthetic_company_stage_packet",
                    "stage_key": "northstar_payroll_due_diligence",
                    "priority": 5,
                    "payload_json": {
                        "schema_version": "orchestration_job_payload.v1",
                        "company": "Northstar Payroll",
                        "allowed_inputs": ["selected_memory", "selected_evidence"],
                        "trusted_write_allowed": trusted_write_allowed,
                    },
                }
            ).encode(),
            headers=auth_headers(token),
        ),
        "job create response",
    )


def wait_for_job_status(base_url: str, token: str, job_id: str, expected_status: str, *, timeout_seconds: float = 10.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_seconds
    latest: dict[str, Any] = {}
    while time.monotonic() < deadline:
        payload = expect_object(
            request(base_url, "/api/evidence-substrate/orchestration/jobs?limit=20", headers={"Authorization": f"Bearer {token}"}),
            "job list response",
        )
        for job in payload.get("jobs", []):
            if isinstance(job, dict) and job.get("job_id") == job_id:
                latest = cast(dict[str, Any], job)
                if latest.get("status") == expected_status:
                    return latest
        time.sleep(0.2)
    raise AssertionError(f"Job {job_id} did not reach {expected_status}; latest={latest}")


def main() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    port = find_free_port()
    base_url = f"http://127.0.0.1:{port}"

    with tempfile.TemporaryDirectory(prefix="izge-worker-queue-smoke-") as temp_dir:
        temp_path = Path(temp_dir)
        env = {
            **os.environ,
            "IZGE_SQLITE_PATH": str(temp_path / "izge.db"),
            "IZGE_STORAGE_ROOT": str(temp_path / "storage"),
            "IZGE_PASTED_TEXT_ROOT": str(temp_path / "pasted"),
            "IZGE_BOOTSTRAP_ADMIN_CREDENTIALS_PATH": str(temp_path / "bootstrap_admin_credentials.json"),
            "IZGE_DEMO_SEED_ENABLED": "true",
            "IZGE_DEFAULT_ADMIN_PASSWORD": "change-me-admin",
            "IZGE_SYNC_DEFAULT_ADMIN_PASSWORD": "true",
        }
        server = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "app.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
                "--log-level",
                "warning",
            ],
            cwd=backend_root,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            wait_for_health(base_url)
            token = sign_in(base_url)
            good_job = create_job(base_url, token, trusted_write_allowed=False)
            rejected_job = create_job(base_url, token, trusted_write_allowed=True)

            worker = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "app.worker",
                    "--worker-id",
                    "smoke-worker-1",
                    "--max-jobs",
                    "2",
                    "--idle-timeout-seconds",
                    "3",
                    "--poll-interval-seconds",
                    "0.2",
                ],
                cwd=backend_root,
                env=env,
                text=True,
                capture_output=True,
                check=False,
                timeout=20,
            )
            if worker.stdout:
                print(worker.stdout, end="")
            if worker.stderr:
                print(worker.stderr, end="", file=sys.stderr)
            if worker.returncode != 0:
                raise SystemExit(worker.returncode)

            completed = wait_for_job_status(base_url, token, str(good_job["job_id"]), "completed")
            failed = wait_for_job_status(base_url, token, str(rejected_job["job_id"]), "failed")
            checks = {
                "worker_process_exited_cleanly": worker.returncode == 0,
                "bounded_job_completed": completed.get("result_json", {}).get("schema_version") == "orchestration_job_result.v1",
                "completed_job_records_worker": completed.get("lease_owner") == "smoke-worker-1",
                "trusted_write_job_rejected": "trusted_write_allowed=false" in str(failed.get("error_message")),
                "result_preserves_bounded_contract": completed.get("result_json", {}).get("trusted_write_allowed") is False,
            }
            failed_checks = [name for name, passed in checks.items() if not passed]
            print(json.dumps({"worker_queue_smoke": checks}, indent=2, sort_keys=True))
            if failed_checks:
                raise AssertionError(f"Worker queue smoke failed checks: {failed_checks}")
        finally:
            terminate_process(server)
            server_stdout, server_stderr = server.communicate(timeout=5)
            if server.returncode not in (0, -15) and server_stderr:
                print(server_stderr, end="", file=sys.stderr)
            elif server_stdout and os.environ.get("IZGE_EVAL_VERBOSE"):
                print(server_stdout, end="")


if __name__ == "__main__":
    main()
