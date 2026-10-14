from __future__ import annotations

from pathlib import Path
import asyncio
from io import BytesIO
import tempfile
import threading
import unittest
import threading
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from starlette.datastructures import Headers, UploadFile
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.db import Base
from app.models import Artifact, ArtifactChunk, ColleagueRun, CompanyChatMessage, User, Workspace, WorkTask
from app.routers.demo import DemoAskCreate, ask_demo, extract_demo
from app.services.colleague import AGENT_EMAIL, _recent_thread_context
from app.services.demo import demo_execution_slot, extract_demo_upload


class DemoIsolationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(prefix="izge-demo-isolation-")
        self.engine = create_engine(
            f"sqlite:///{Path(self.temp_dir.name) / 'test.db'}",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine, expire_on_commit=False)
        workspace = Workspace(name="Pusula Yazılım ve IT Danışmanlık", description="Demo")
        self.db.add(workspace)
        self.db.flush()
        self.actor = User(
            workspace_id=workspace.workspace_id,
            role="Member",
            display_name="Kerem Demir",
            email="demo-visitor-kerem@public-demo.invalid",
            password_hash="unused",
            is_public_demo=True,
            public_demo_persona="kerem",
            public_demo_ip_hash="ip-hash",
            public_demo_visitor_hash="visitor-hash",
        )
        self.agent = User(
            workspace_id=workspace.workspace_id,
            role="Member",
            display_name="İzge",
            email=AGENT_EMAIL,
            password_hash="unused",
        )
        self.db.add_all([self.actor, self.agent])
        self.db.flush()
        self.old_run = ColleagueRun(
            workspace_id=workspace.workspace_id,
            created_by=self.actor.user_id,
            kind="ask",
            client_request_id="old-queued-request",
            thread_id="old-thread",
            thread_title="Old",
            thread_kind="direct",
            participant_user_ids=[self.actor.user_id, self.agent.user_id],
            question="Old queued question",
            status="queued",
        )
        self.db.add(self.old_run)
        self.db.add(Artifact(
            artifact_id="browser-id",
            workspace_id=workspace.workspace_id,
            title="Existing source with colliding client ID",
            source_type="pasted_text",
            source_path="existing",
            mime_type="text/plain",
            uploaded_by=self.actor.user_id,
            visibility_scope="workspace",
            ingestion_status="completed",
        ))
        self.task = WorkTask(
            workspace_id=workspace.workspace_id,
            created_by=self.actor.user_id,
            assignee_user_id=self.actor.user_id,
            title="Original task",
            description="Original description",
            status="open",
            source_artifact_ids=["browser-id"],
            source_snapshot={"browser-id": {"title": "Existing source"}},
        )
        self.db.add(self.task)
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()
        self.temp_dir.cleanup()

    def counts(self) -> tuple[int, int, int, int, int]:
        self.db.expire_all()
        return (
            self.db.scalar(select(func.count()).select_from(ColleagueRun)),
            self.db.scalar(select(func.count()).select_from(CompanyChatMessage)),
            self.db.scalar(select(func.count()).select_from(Artifact)),
            self.db.scalar(select(func.count()).select_from(ArtifactChunk)),
            self.db.scalar(select(func.count()).select_from(WorkTask)),
        )

    def test_question_runs_in_memory_and_returns_only_isolated_messages(self) -> None:
        before = self.counts()

        def complete(clone_db: Session, run: ColleagueRun, *, lease_owner: str | None = None) -> ColleagueRun:
            self.assertTrue(lease_owner and lease_owner.startswith("demo-sync:"))
            self.assertEqual("queued", clone_db.get(ColleagueRun, self.old_run.run_id).status)
            self.assertEqual(1, len(run.context_artifact_ids))
            local_artifact = clone_db.get(Artifact, run.context_artifact_ids[0])
            self.assertIsNotNone(local_artifact)
            self.assertNotEqual("browser-id", local_artifact.artifact_id)
            self.assertEqual(1, clone_db.scalar(select(func.count()).select_from(ArtifactChunk).where(ArtifactChunk.artifact_id == local_artifact.artifact_id)))
            context = _recent_thread_context(clone_db, run)
            self.assertEqual("Seçili yanıt ve son tarayıcı mesajları.", context[-1]["answer"])
            cloned_task = clone_db.get(WorkTask, self.task.task_id)
            self.assertEqual("done", cloned_task.status)
            self.assertNotEqual(["browser-id"], cloned_task.source_artifact_ids)
            new_task = clone_db.scalar(select(WorkTask).where(WorkTask.title == "Browser-only task"))
            self.assertIsNotNone(new_task)
            self.assertEqual(self.actor.user_id, new_task.created_by)
            self.assertEqual(self.actor.user_id, new_task.assignee_user_id)
            run.sources = [{
                "artifact_id": local_artifact.artifact_id,
                "title": local_artifact.title,
                "quote": "Yalnız bu istek için kaynak metni.",
                "chunk_id": clone_db.scalar(select(ArtifactChunk.chunk_id).where(ArtifactChunk.artifact_id == local_artifact.artifact_id)),
            }]
            run.answer = "İzole yanıt"
            run.status = "completed"
            run.lease_owner = None
            run.lease_expires_at = None
            clone_db.add(CompanyChatMessage(
                workspace_id=run.workspace_id,
                author_user_id=self.agent.user_id,
                body=run.answer,
                message_metadata={
                    "thread_id": run.thread_id,
                    "thread_title": run.thread_title,
                    "thread_kind": run.thread_kind,
                    "participant_user_ids": run.participant_user_ids,
                    "colleague_run_id": run.run_id,
                    "source_refs": run.sources,
                },
            ))
            clone_db.commit()
            return run

        payload = DemoAskCreate(
            message="Bu yerel kaynağa göre ne oldu?",
            client_request_id="request-12345678",
            history=[{"question": "Önce ne konuşmuştuk?", "answer": "Bir önceki yanıt."}],
            local_sources=[{"artifact_id": "browser-id", "title": "Tarayıcı notu", "text": "Yalnız bu istek için kaynak metni."}],
            conversation_context="Seçili yanıt ve son tarayıcı mesajları.",
            local_tasks=[
                {
                    "task_id": self.task.task_id,
                    "title": "Edited task",
                    "description": "Edited only in browser",
                    "status": "done",
                    "assignee_user_id": "ignored-for-existing",
                    "source_artifact_ids": ["browser-id"],
                },
                {
                    "task_id": "browser-new-task",
                    "title": "Browser-only task",
                    "description": None,
                    "status": "open",
                    "assignee_user_id": "ignored-for-new",
                    "source_artifact_ids": [],
                },
            ],
        )
        with (
            patch("app.routers.demo.consume_public_demo_quota", return_value=1),
            patch("app.services.demo.process_colleague_run", side_effect=complete),
        ):
            response = ask_demo(payload, self.actor, self.db)

        self.assertEqual("completed", response.run.status)
        self.assertEqual(["browser-id"], [source.artifact_id for source in response.run.sources])
        self.assertEqual(["Bu yerel kaynağa göre ne oldu?", "İzole yanıt"], [message.body for message in response.messages])
        self.assertEqual("browser-id", response.messages[-1].message_metadata["source_refs"][0]["artifact_id"])
        self.assertEqual(before, self.counts())
        self.assertEqual("queued", self.db.get(ColleagueRun, self.old_run.run_id).status)
        self.assertEqual("open", self.db.get(WorkTask, self.task.task_id).status)
        self.assertEqual(["browser-id"], self.db.get(WorkTask, self.task.task_id).source_artifact_ids)

    def test_failure_does_not_persist_isolated_state(self) -> None:
        before = self.counts()
        payload = DemoAskCreate(message="Fail safely", client_request_id="request-87654321")
        with (
            patch("app.routers.demo.consume_public_demo_quota", return_value=1),
            patch("app.services.demo.process_colleague_run", side_effect=RuntimeError("model failed")),
            self.assertRaisesRegex(RuntimeError, "model failed"),
        ):
            ask_demo(payload, self.actor, self.db)
        self.assertEqual(before, self.counts())
        self.assertEqual("queued", self.db.get(ColleagueRun, self.old_run.run_id).status)

    def test_live_deltas_arrive_before_completion_without_shared_writes(self) -> None:
        import asyncio
        from app.routers.demo import stream_demo_answer
        from app.services.colleague import add_run_event

        before = self.counts()
        release = threading.Event()

        def complete(clone_db, run, *, lease_owner):
            add_run_event(clone_db, run, "delta", text="İlk yanıt", lease_owner=lease_owner)
            if not release.wait(5):
                raise RuntimeError("Test did not read the live delta")
            run.answer = "İlk yanıt tamamlandı"
            run.status = "completed"
            clone_db.commit()
            return run

        async def read_stream():
            response = stream_demo_answer(DemoAskCreate(message="Atlas kontrolü", client_request_id="stream-test-1234"), self.actor, self.db)
            iterator = response.body_iterator
            self.assertIn("event: accepted", await anext(iterator))
            self.assertIn("İlk yanıt", await anext(iterator))
            release.set()
            self.assertIn('"status": "completed"', await anext(iterator))
            with self.assertRaises(StopAsyncIteration):
                await anext(iterator)

        with patch("app.routers.demo.consume_public_demo_quota", return_value=1), patch("app.routers.demo.process_colleague_run", side_effect=complete):
            try:
                asyncio.run(read_stream())
            finally:
                release.set()
        self.assertEqual(before, self.counts())

    def test_text_extraction_stays_in_memory(self) -> None:
        upload = UploadFile(
            BytesIO("Tarayıcıda kalacak demo notu.".encode()),
            filename="note.md",
            headers=Headers({"content-type": "text/markdown"}),
        )
        self.assertEqual("Tarayıcıda kalacak demo notu.", asyncio.run(extract_demo_upload(upload)))

    def test_extraction_is_two_megabytes_threaded_and_releases_slot_on_error(self) -> None:
        oversized = UploadFile(
            BytesIO(b"x" * (2 * 1024 * 1024 + 1)),
            filename="large.txt",
            headers=Headers({"content-type": "text/plain"}),
        )
        with self.assertRaises(HTTPException) as too_large:
            asyncio.run(extract_demo_upload(oversized))
        self.assertEqual(413, too_large.exception.status_code)

        main_thread = threading.get_ident()
        worker_threads: list[int] = []

        def fail_once(content: bytes, suffix: str) -> str:
            worker_threads.append(threading.get_ident())
            raise ValueError("broken document")

        broken = UploadFile(BytesIO(b"broken"), filename="broken.txt", headers=Headers({"content-type": "text/plain"}))
        with patch("app.services.demo.extract_demo_bytes", side_effect=fail_once), self.assertRaises(HTTPException) as failed:
            asyncio.run(extract_demo_upload(broken))
        self.assertEqual(422, failed.exception.status_code)
        self.assertTrue(worker_threads and worker_threads[0] != main_thread)

        retry = UploadFile(BytesIO(b"works"), filename="retry.txt", headers=Headers({"content-type": "text/plain"}))
        self.assertEqual("works", asyncio.run(extract_demo_upload(retry)))

    def test_extract_endpoint_uses_distinct_hourly_quota(self) -> None:
        upload = UploadFile(BytesIO(b"text"), filename="note.txt", headers=Headers({"content-type": "text/plain"}))
        with (
            patch("app.routers.demo.consume_public_demo_quota", return_value=1) as quota,
            patch("app.routers.demo.extract_demo_upload", new=AsyncMock(return_value="text")),
        ):
            response = asyncio.run(extract_demo(upload, self.actor))
        self.assertEqual("text", response.text)
        quota.assert_called_once_with(ip_hash="extract:ip-hash", limit=10)

    def test_demo_work_has_two_shared_nonblocking_slots(self) -> None:
        with demo_execution_slot(), demo_execution_slot():
            with self.assertRaises(HTTPException) as busy:
                with demo_execution_slot():
                    pass
            self.assertEqual(503, busy.exception.status_code)
        with demo_execution_slot():
            pass


if __name__ == "__main__":
    unittest.main()
