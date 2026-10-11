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
from app.models import Artifact, ArtifactPermission, AssistantConversation, ColleagueRun, CompanyChatMessage, User, Workspace
from app.routers.team_chat import list_team_chat_messages
from app.routers.work import (
    attach_conversation_file,
    create_conversation,
    delete_conversation,
    get_conversation,
    list_conversations,
    list_runs,
    update_conversation,
)
from app.schemas.work import AssistantConversationCreate, AssistantConversationUpdate
from app.services.colleague import enqueue_colleague_question


class AssistantConversationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.engine = create_engine(f"sqlite:///{Path(self.temp_dir.name) / 'test.db'}")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine, expire_on_commit=False)
        self.workspace = Workspace(name="Test", description="")
        self.db.add(self.workspace)
        self.db.flush()
        self.alice = self._user("Alice", "alice@example.com")
        self.bob = self._user("Bob", "bob@example.com")
        self.admin = self._user("Admin", "admin@example.com", "Admin")
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()
        self.temp_dir.cleanup()

    def _user(self, name: str, email: str, role: str = "Member") -> User:
        user = User(
            workspace_id=self.workspace.workspace_id,
            role=role,
            display_name=name,
            email=email,
            password_hash="unused",
            is_active=True,
        )
        self.db.add(user)
        self.db.flush()
        return user

    def _create(self, title: str = "Roadmap") -> AssistantConversation:
        result = create_conversation(AssistantConversationCreate(title=title), self.alice, self.db)
        conversation = self.db.get(AssistantConversation, result.conversation_id)
        assert conversation is not None
        return conversation

    def test_default_and_created_conversations_are_private_per_user(self) -> None:
        default = list_conversations(False, self.alice, self.db).items[0]
        self.assertEqual("izge-colleague", default.thread_id)
        created = self._create()
        self.assertTrue(created.thread_id.startswith("assistant-cowork:"))

        self.assertEqual(2, len(list_conversations(False, self.alice, self.db).items))
        self.assertEqual(1, len(list_conversations(False, self.bob, self.db).items))
        for reader in (self.bob, self.admin):
            with self.subTest(reader=reader.display_name), self.assertRaises(HTTPException) as denied:
                get_conversation(created.conversation_id, reader, self.db)
            self.assertEqual(404, denied.exception.status_code)

    def test_legacy_personal_threads_are_discovered_without_importing_shared_direct_threads(self) -> None:
        personal = ColleagueRun(
            workspace_id=self.workspace.workspace_id, created_by=self.alice.user_id, kind="ask",
            thread_id="legacy-personal", thread_title="Legacy", thread_kind="direct",
            participant_user_ids=[self.alice.user_id], question="Old question", status="completed",
        )
        shared = ColleagueRun(
            workspace_id=self.workspace.workspace_id, created_by=self.alice.user_id, kind="ask",
            thread_id="legacy-shared", thread_title="Shared", thread_kind="direct",
            participant_user_ids=[self.alice.user_id, self.bob.user_id], question="Shared question", status="completed",
        )
        self.db.add_all([personal, shared])
        self.db.commit()

        threads = {item.thread_id for item in list_conversations(True, self.alice, self.db).items}

        self.assertIn("legacy-personal", threads)
        self.assertNotIn("legacy-shared", threads)

    def test_archive_delete_and_active_run_rules_do_not_mutate_chat_or_artifacts(self) -> None:
        conversation = self._create()
        run = enqueue_colleague_question(
            self.db,
            actor=self.alice,
            message="Plan nedir?",
            client_request_id="conversation-active-run",
            thread_id=conversation.thread_id,
            thread_title=conversation.title,
            thread_kind="direct",
            participant_user_ids=[self.alice.user_id],
        )
        with self.assertRaises(HTTPException) as active:
            update_conversation(conversation.conversation_id, AssistantConversationUpdate(archived=True), self.alice, self.db)
        self.assertEqual(409, active.exception.status_code)

        run.status = "completed"
        artifact = Artifact(
            workspace_id=self.workspace.workspace_id,
            title="Business record",
            source_type="pasted_text",
            source_path="/record.txt",
            mime_type="text/plain",
            uploaded_by=self.alice.user_id,
            visibility_scope="workspace",
        )
        group_message = CompanyChatMessage(
            workspace_id=self.workspace.workspace_id,
            author_user_id=self.alice.user_id,
            body="Keep me",
            message_metadata={"thread_id": "group:delivery", "thread_kind": "group", "participant_user_ids": [self.alice.user_id, self.bob.user_id]},
        )
        self.db.add_all([artifact, group_message])
        self.db.commit()

        update_conversation(conversation.conversation_id, AssistantConversationUpdate(archived=True), self.alice, self.db)
        self.assertNotIn(conversation.conversation_id, {item.conversation_id for item in list_conversations(False, self.alice, self.db).items})
        self.assertIn(conversation.conversation_id, {item.conversation_id for item in list_conversations(True, self.alice, self.db).items})
        with self.assertRaises(HTTPException) as archived:
            enqueue_colleague_question(
                self.db, actor=self.alice, message="Again", client_request_id="conversation-archived-run",
                thread_id=conversation.thread_id, thread_title=conversation.title, thread_kind="direct",
                participant_user_ids=[self.alice.user_id],
            )
        self.assertEqual(409, archived.exception.status_code)

        update_conversation(conversation.conversation_id, AssistantConversationUpdate(archived=False), self.alice, self.db)
        delete_conversation(conversation.conversation_id, self.alice, self.db)
        self.assertIsNotNone(self.db.get(AssistantConversation, conversation.conversation_id).deleted_at)
        self.assertIsNotNone(self.db.get(ColleagueRun, run.run_id))
        self.assertIsNotNone(self.db.get(Artifact, artifact.artifact_id))
        self.assertIsNotNone(self.db.get(CompanyChatMessage, group_message.message_id))
        visible_chat = list_team_chat_messages(200, self.alice, self.db).messages
        self.assertFalse(any(message.message_metadata.get("thread_id") == conversation.thread_id for message in visible_chat))
        self.assertNotIn(run.run_id, {item.run_id for item in list_runs(40, self.alice, self.db, conversation.thread_id).items})

    def test_archived_conversation_cannot_be_reopened_using_previous_agent_participants(self) -> None:
        conversation = self._create()
        first = enqueue_colleague_question(
            self.db, actor=self.alice, message="Hi", client_request_id="prior-participants-first",
            thread_id=conversation.thread_id, thread_title=conversation.title, thread_kind="direct",
            participant_user_ids=[self.alice.user_id],
        )
        first.status = "completed"
        self.db.commit()
        update_conversation(conversation.conversation_id, AssistantConversationUpdate(archived=True), self.alice, self.db)
        with self.assertRaises(HTTPException) as blocked:
            enqueue_colleague_question(
                self.db, actor=self.alice, message="Again", client_request_id="prior-participants-second",
                thread_id=conversation.thread_id, thread_title=conversation.title, thread_kind="direct",
                participant_user_ids=first.participant_user_ids,
            )
        self.assertEqual(409, blocked.exception.status_code)

    def test_attachment_is_private_and_pinned_as_chat_context(self) -> None:
        conversation = self._create()
        upload = UploadFile(
            filename="plan.txt",
            file=BytesIO(b"Launch checkpoint is Friday."),
            headers=Headers({"content-type": "text/plain"}),
        )
        target = Path(self.temp_dir.name) / "plan.txt"

        def persist(content: bytes, *, artifact_id: str, filename: str | None) -> tuple[str, str]:
            target.write_bytes(content)
            return str(target), "checksum"

        with (
            patch("app.routers.team_chat.persist_upload_bytes", side_effect=persist),
            patch("app.routers.artifacts._feed_memory_inline", return_value=True),
        ):
            message = asyncio.run(attach_conversation_file(conversation.conversation_id, upload, self.alice, self.db))

        artifact_id = message.message_metadata["attachments"][0]["artifact_id"]
        artifact = self.db.get(Artifact, artifact_id)
        assert artifact is not None
        self.assertEqual("team_chat_attachment", artifact.source_type)
        self.assertEqual("restricted", artifact.visibility_scope)
        self.assertEqual([self.alice.user_id], list(self.db.scalars(select(ArtifactPermission.user_id).where(ArtifactPermission.artifact_id == artifact_id))))
        run = enqueue_colleague_question(
            self.db,
            actor=self.alice,
            message="Dosyadaki kontrol noktası ne zaman?",
            client_request_id="conversation-attachment-run",
            thread_id=conversation.thread_id,
            thread_title=conversation.title,
            thread_kind="direct",
            participant_user_ids=[self.alice.user_id],
        )
        self.assertEqual([artifact_id], run.context_artifact_ids)


if __name__ == "__main__":
    unittest.main()
