#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
PYTHON_BIN="${PYTHON:-$BACKEND_DIR/.venv/bin/python}"

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Python interpreter not found at $PYTHON_BIN. Set PYTHON=/path/to/python or create backend/.venv." >&2
  exit 1
fi

cd "$BACKEND_DIR"
"$PYTHON_BIN" - <<'PY'
import os
import shutil
import tempfile
from pathlib import Path

root = Path(tempfile.mkdtemp(prefix="izge-backend-api-smoke-"))
try:
    os.environ.update(
        {
            "IZGE_SQLITE_PATH": str(root / "izge.db"),
            "IZGE_STORAGE_ROOT": str(root / "storage"),
            "IZGE_PASTED_TEXT_ROOT": str(root / "pasted"),
            "IZGE_BOOTSTRAP_ADMIN_CREDENTIALS_PATH": str(root / "bootstrap_admin_credentials.json"),
            "IZGE_DEFAULT_ADMIN_EMAIL": "admin@example.com",
            "IZGE_DEFAULT_ADMIN_PASSWORD": "change-me-admin",
            "IZGE_SYNC_DEFAULT_ADMIN_PASSWORD": "true",
            "IZGE_LOCAL_LLM_ENABLED": "false",
        }
    )

    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as client:
        admin_response = client.post(
            "/api/auth/sign-in",
            json={"email": "admin@example.com", "password": "change-me-admin"},
        )
        assert admin_response.status_code == 200, admin_response.text
        admin_token = admin_response.json()["access_token"]

        employee_response = client.post(
            "/api/auth/sign-in",
            json={"email": "employee1@example.com", "password": "change-me-employee1"},
        )
        assert employee_response.status_code == 200, employee_response.text
        employee_token = employee_response.json()["access_token"]

        users_response = client.get(
            "/api/users",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert users_response.status_code == 200, users_response.text
        emails = {user["email"] for user in users_response.json()}
        expected_employees = {"employee1@example.com", "employee2@example.com", "employee3@example.com"}
        assert expected_employees <= emails, emails

        chat_response = client.post(
            "/api/team-chat",
            headers={"Authorization": f"Bearer {employee_token}"},
            json={
                "body": "backend API smoke threaded message",
                "thread_id": "direct:employee1-employee2",
                "thread_title": "Employee 1 / Employee 2",
            },
        )
        assert chat_response.status_code == 201, chat_response.text
        metadata = chat_response.json()["message_metadata"]
        assert metadata["thread_id"] == "direct:employee1-employee2", metadata
        assert metadata["thread_title"] == "Employee 1 / Employee 2", metadata

        llm_response = client.get(
            "/api/system/llm-status",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert llm_response.status_code == 200, llm_response.text
        assert llm_response.json()["enabled"] is False, llm_response.text

    print("BACKEND_API_SMOKE_OK")
finally:
    shutil.rmtree(root, ignore_errors=True)
PY
