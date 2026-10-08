from __future__ import annotations

from contextlib import closing
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
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
    raise RuntimeError(f"Timed out waiting for isolated synthetic backend health at {base_url}: {last_error}")


def terminate_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def main() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    port = find_free_port()
    base_url = f"http://127.0.0.1:{port}"

    with tempfile.TemporaryDirectory(prefix="izge-synthetic-company-eval-") as temp_dir:
        temp_path = Path(temp_dir)
        env = {
            **os.environ,
            "IZGE_SQLITE_PATH": str(temp_path / "izge.db"),
            "IZGE_STORAGE_ROOT": str(temp_path / "storage"),
            "IZGE_PASTED_TEXT_ROOT": str(temp_path / "pasted"),
            "IZGE_BOOTSTRAP_ADMIN_CREDENTIALS_PATH": str(temp_path / "bootstrap_admin_credentials.json"),
            "IZGE_DEMO_SEED_ENABLED": "true",
            "IZGE_DEFAULT_ADMIN_PASSWORD": "change-me-admin",
            "IZGE_EVAL_BASE_URL": base_url,
        }
        server_log = tempfile.TemporaryFile(mode="w+t")
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
            stdout=server_log,
            stderr=subprocess.STDOUT,
            text=True,
        )
        result = None
        try:
            wait_for_health(base_url)
            result = subprocess.run(
                [sys.executable, "-m", "manual_eval.run_synthetic_company_workflow"],
                cwd=backend_root,
                env=env,
                text=True,
                capture_output=True,
                check=False,
                timeout=180,
            )
            if result.stdout:
                print(result.stdout, end="")
            if result.stderr:
                print(result.stderr, end="", file=sys.stderr)
            if result.returncode != 0:
                raise SystemExit(result.returncode)
            print(f"\nIsolated synthetic company workflow passed against {base_url}.")
        finally:
            terminate_process(server)
            server_log.seek(0)
            server_stderr = server_log.read()
            server_stdout = server_stderr
            server_log.close()
            if server_stderr and (server.returncode not in (0, -15) or result is None or result.returncode != 0):
                print(server_stderr, end="", file=sys.stderr)
            elif server_stdout and os.environ.get("IZGE_EVAL_VERBOSE"):
                print(server_stdout, end="")


if __name__ == "__main__":
    main()
