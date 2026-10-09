from __future__ import annotations

import asyncio
from io import BytesIO
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from starlette.datastructures import Headers

from app.db import Base
from app.models import Artifact, ArtifactChunk, ArtifactPermission, CompanyChatMessage, User, Workspace
from app.routers.artifacts import preview_artifact_source
from app.routers.team_chat import attach_team_chat_file, list_team_chat_messages
from app.services.colleague import enqueue_colleague_question, retrieve_shared_context
from app.services.permissions import artifact_is_visible_to_user


class TeamChatAttachmentTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.engine = create_engine(f"sqlite:///{Path(self.temp_dir.name) / 'test.db'}")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine, expire_on_commit=False)
        self.workspace = Workspace(name="Test", description="")
        self.other_workspace = Workspace(name="Other", description="")
        self.db.add_all([self.workspace, self.other_workspace])
        self.db.flush()
        self.alice = self._user(self.workspace, "Alice", "alice@example.com")
        self.bob = self._user(self.workspace, "Bob", "bob@example.com")
        self.admin = self._user(self.workspace, "Admin", "admin@example.com", "Admin")
        self.other = self._user(self.other_workspace, "Other", "other@example.com", "Admin")
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()
        self.temp_dir.cleanup()

    def _user(self, workspace: Workspace, name: str, email: str, role: str = "Member") -> User:
        user = User(
            workspace_id=workspace.workspace_id,
            role=role,
            display_name=name,
            email=email,
            password_hash="unused",
            is_active=True,
        )
        self.db.add(user)
        self.db.flush()
        return user

    def _upload(self, *, thread_kind: str = "group") -> CompanyChatMessage:
        upload = UploadFile(
            filename="musteri-notu.txt",
            file=BytesIO(b"Musteri ek teslim icin 6 saat calisma istedi."),
            headers=Headers({"content-type": "text/plain"}),
        )
        target = Path(self.temp_dir.name) / "source.txt"

        def persist(content: bytes, *, artifact_id: str, filename: str | None) -> tuple[str, str]:
            target.write_bytes(content)
            return str(target), "checksum"

        with (
            patch("app.routers.team_chat.persist_upload_bytes", side_effect=persist),
            patch("app.routers.artifacts._feed_memory_inline", return_value=True),
        ):
            created = asyncio.run(attach_team_chat_file(
                file=upload,
                thread_id="group:delivery" if thread_kind == "group" else "izge-colleague" if thread_kind == "direct" else "company-general",
                thread_title="Teslimat",
                thread_kind=thread_kind,
                participant_user_ids=f'["{self.bob.user_id}"]' if thread_kind == "group" else "[]",
                current_user=self.alice,
                db=self.db,
            ))
        return self.db.get(CompanyChatMessage, created.message_id)

    def test_private_attachment_is_one_retrievable_conversation_source_for_members_only(self) -> None:
        self.db.add(CompanyChatMessage(
            workspace_id=self.workspace.workspace_id,
            author_user_id=self.alice.user_id,
            body="Teslim konuşması",
            message_metadata={
                "thread_id": "group:delivery",
                "thread_kind": "group",
                "participant_user_ids": [self.alice.user_id, self.bob.user_id],
            },
        ))
        self.db.commit()
        message = self._upload()
        attachment = message.message_metadata["attachments"][0]
        artifact = self.db.get(Artifact, attachment["artifact_id"])
        self.assertEqual("team_chat_attachment", artifact.source_type)
        self.assertEqual("restricted", artifact.visibility_scope)
        self.assertEqual(1, self.db.query(Artifact).filter(Artifact.artifact_id == artifact.artifact_id).count())
        self.assertEqual(
            {self.alice.user_id, self.bob.user_id},
            set(self.db.scalars(select(ArtifactPermission.user_id).where(ArtifactPermission.artifact_id == artifact.artifact_id)).all()),
        )
        self.assertTrue(artifact_is_visible_to_user(self.db, artifact, self.bob))
        self.assertFalse(artifact_is_visible_to_user(self.db, artifact, self.admin))
        self.assertFalse(artifact_is_visible_to_user(self.db, artifact, self.other))
        self.assertIn(message.message_id, {item.message_id for item in list_team_chat_messages(80, self.bob, self.db).messages})
        self.assertNotIn(message.message_id, {item.message_id for item in list_team_chat_messages(80, self.admin, self.db).messages})

        source_file = Path(self.temp_dir.name) / "source.txt"
        with patch("app.routers.artifacts._artifact_source_file", return_value=source_file):
            self.assertEqual("text/plain", preview_artifact_source(artifact.artifact_id, self.bob, self.db).media_type)
            with self.assertRaises(HTTPException) as denied:
                preview_artifact_source(artifact.artifact_id, self.admin, self.db)
        self.assertEqual(403, denied.exception.status_code)

        self.db.add(ArtifactChunk(
            artifact_id=artifact.artifact_id,
            workspace_id=self.workspace.workspace_id,
            sequence_number=0,
            text="Müşteri ek teslim için 6 saat çalışma istedi.",
            chunk_metadata={},
        ))
        self.db.commit()
        run = enqueue_colleague_question(
            self.db,
            actor=self.alice,
            message="@izge müşteri ek teslim için kaç saat istedi?",
            client_request_id="attachment-question",
            thread_id="group:delivery",
            thread_title="Teslimat",
            thread_kind="group",
            participant_user_ids=[self.bob.user_id],
        )
        self.assertEqual([artifact.artifact_id], run.context_artifact_ids)
        sources, _ = retrieve_shared_context(self.db, run)
        self.assertEqual(artifact.artifact_id, sources[0]["artifact_id"])

    def test_channel_attachment_is_available_to_workspace_without_starting_an_agent_run(self) -> None:
        before_run_count = self.db.query(CompanyChatMessage).count()
        message = self._upload(thread_kind="channel")
        artifact_id = message.message_metadata["attachments"][0]["artifact_id"]
        artifact = self.db.get(Artifact, artifact_id)
        self.assertEqual("workspace", artifact.visibility_scope)
        self.assertTrue(artifact_is_visible_to_user(self.db, artifact, self.admin))
        self.assertEqual(before_run_count + 1, self.db.query(CompanyChatMessage).count())
        self.assertTrue(message.message_metadata["attachment_only"])

    def test_attachment_can_start_the_private_izge_conversation(self) -> None:
        message = self._upload(thread_kind="direct")
        artifact = self.db.get(Artifact, message.message_metadata["attachments"][0]["artifact_id"])
        self.assertEqual([self.alice.user_id], message.message_metadata["participant_user_ids"])
        self.assertTrue(artifact_is_visible_to_user(self.db, artifact, self.alice))
        self.assertFalse(artifact_is_visible_to_user(self.db, artifact, self.bob))

    def test_existing_group_cannot_change_members_or_become_a_public_attachment(self) -> None:
        self.db.add(CompanyChatMessage(workspace_id=self.workspace.workspace_id,
            author_user_id=self.alice.user_id, body="Group",
            message_metadata={"thread_id": "group:delivery", "thread_kind": "group",
                "participant_user_ids": [self.alice.user_id, self.bob.user_id]}))
        self.db.commit()
        import json
        for kind, members in [("group", [self.admin.user_id]), ("channel", [])]:
            with self.subTest(kind=kind), self.assertRaises(HTTPException) as rejected:
                asyncio.run(attach_team_chat_file(
                    file=UploadFile(filename="note.txt", file=BytesIO(b"private"), headers=Headers({"content-type":"text/plain"})),
                    thread_id="group:delivery", thread_title="Delivery", thread_kind=kind,
                    participant_user_ids=json.dumps(members), current_user=self.alice, db=self.db))
            self.assertEqual(400, rejected.exception.status_code)
            self.assertEqual(0, self.db.query(Artifact).count())

    def test_post_commit_side_effect_failure_does_not_report_false_upload_failure(self) -> None:
        for function in ["log_event", "notify_team_chat_recipients"]:
            before = self.db.query(Artifact).count()
            with self.subTest(function=function), patch("app.routers.team_chat." + function, side_effect=RuntimeError("side effect unavailable")), self.assertLogs("app.routers.team_chat", level="ERROR"):
                message = self._upload(thread_kind="channel")
            self.assertTrue(message.message_metadata["attachment_only"])
            self.assertEqual(before + 1, self.db.query(Artifact).count())


if __name__ == "__main__":
    unittest.main()
