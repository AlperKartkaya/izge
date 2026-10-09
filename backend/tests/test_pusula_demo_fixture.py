from __future__ import annotations

import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

from manual_eval.pusula_demo.fixture import (
    ARTIFACTS,
    CHAT_MESSAGES,
    LIVE_UPLOAD_FILENAMES,
    PERSONAS,
    TASKS,
    validate_fixture,
)


class PusulaDemoFixtureTests(unittest.TestCase):
    def test_fixture_covers_six_cases_and_keeps_live_files_out(self) -> None:
        validate_fixture()
        self.assertEqual({case for *_rest, cases in ARTIFACTS for case in cases}, set(range(1, 7)))
        self.assertFalse({filename for _key, _title, filename, _cases in ARTIFACTS} & LIVE_UPLOAD_FILENAMES)
        self.assertFalse(any("Excel" in task["title"] or "dışa aktar" in task["title"] for task in TASKS))

    def test_seed_builds_isolated_workspace_without_printing_passwords(self) -> None:
        backend_root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(prefix="izge-pusula-seed-test-") as temp_dir:
            root = Path(temp_dir)
            credentials = root / "private" / "credentials.json"
            command = [
                sys.executable,
                "-m",
                "manual_eval.seed_pusula_demo",
                "--database",
                str(root / "izge.db"),
                "--storage-root",
                str(root / "storage"),
                "--pasted-root",
                str(root / "pasted"),
                "--credentials-file",
                str(credentials),
            ]
            result = subprocess.run(command, cwd=backend_root, env=os.environ, text=True, capture_output=True, timeout=120, check=False)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

            credential_payload = json.loads(credentials.read_text(encoding="utf-8"))
            self.assertEqual(set(credential_payload), {persona["key"] for persona in PERSONAS})
            for item in credential_payload.values():
                self.assertNotIn(item["password"], result.stdout)
            self.assertEqual(credentials.stat().st_mode & 0o777, 0o600)

            with sqlite3.connect(root / "izge.db") as db:
                self.assertEqual(db.execute("SELECT name FROM workspace").fetchone()[0], "Pusula Yazılım ve IT Danışmanlık")
                self.assertEqual(db.execute("SELECT COUNT(*) FROM users WHERE email != 'izge-agent@local.invalid'").fetchone()[0], len(PERSONAS))
                self.assertEqual(db.execute("SELECT COUNT(*) FROM artifacts").fetchone()[0], len(ARTIFACTS))
                self.assertEqual(db.execute("SELECT COUNT(*) FROM company_chat_messages").fetchone()[0], len(CHAT_MESSAGES))
                self.assertEqual(db.execute("SELECT COUNT(*) FROM work_tasks").fetchone()[0], len(TASKS))
                self.assertEqual(db.execute("SELECT COUNT(*) FROM automations").fetchone()[0], 3)
                self.assertTrue(db.execute("SELECT created_at FROM company_chat_messages ORDER BY created_at LIMIT 1").fetchone()[0].startswith("2026-10-05 06:12"))
                filenames = {row[0] for row in db.execute("SELECT original_filename FROM artifacts")}
                self.assertFalse(filenames & LIVE_UPLOAD_FILENAMES)
                self.assertEqual(db.execute("SELECT COUNT(*) FROM work_tasks WHERE title LIKE '%Excel%' OR title LIKE '%dışa aktar%'").fetchone()[0], 0)

            refused = subprocess.run(command, cwd=backend_root, env=os.environ, text=True, capture_output=True, timeout=30, check=False)
            self.assertNotEqual(refused.returncode, 0)
            self.assertIn("--replace", refused.stderr)

    def test_seed_refuses_dangerous_delete_target(self) -> None:
        backend_root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(prefix="izge-pusula-path-test-") as temp_dir:
            root = Path(temp_dir)
            result = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "manual_eval.seed_pusula_demo",
                    "--database",
                    str(root / "izge.db"),
                    "--storage-root",
                    "/",
                    "--pasted-root",
                    str(root / "pasted"),
                    "--credentials-file",
                    str(root / "credentials.json"),
                ],
                cwd=backend_root,
                env=os.environ,
                text=True,
                capture_output=True,
                timeout=30,
                check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Güvensiz storage hedefi", result.stderr)


if __name__ == "__main__":
    unittest.main()
