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


def wait_for_health(base_url: str, *, timeout_seconds: float = 15.0) -> None:
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
    raise RuntimeError(f"Timed out waiting for isolated backend health at {base_url}: {last_error}")


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

    with tempfile.TemporaryDirectory(prefix="izge-isolated-eval-") as temp_dir:
        temp_path = Path(temp_dir)
        env = {
            **os.environ,
            "IZGE_SQLITE_PATH": str(temp_path / "izge.db"),
            "IZGE_STORAGE_ROOT": str(temp_path / "storage"),
            "IZGE_PASTED_TEXT_ROOT": str(temp_path / "pasted"),
            "IZGE_BOOTSTRAP_ADMIN_CREDENTIALS_PATH": str(temp_path / "bootstrap_admin_credentials.json"),
            "IZGE_EVAL_BASE_URL": base_url,
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
            result = subprocess.run(
                [sys.executable, "-m", "manual_eval.run_seed_eval"],
                cwd=backend_root,
                env=env,
                text=True,
                capture_output=True,
                check=False,
            )
            if result.stdout:
                print(result.stdout, end="")
            if result.stderr:
                print(result.stderr, end="", file=sys.stderr)
            if result.returncode != 0:
                raise SystemExit(result.returncode)
            print(f"\nIsolated seed eval passed against {base_url}.")
        finally:
            terminate_process(server)
            server_stdout, server_stderr = server.communicate(timeout=5)
            if server.returncode not in (0, -15) and server_stderr:
                print(server_stderr, end="", file=sys.stderr)
            elif server_stdout and os.environ.get("IZGE_EVAL_VERBOSE"):
                print(server_stdout, end="")


if __name__ == "__main__":
    main()
