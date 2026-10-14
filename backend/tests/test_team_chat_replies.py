from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.db import Base
from app.models import CompanyChatMessage, User, Workspace
from app.routers.team_chat import create_team_chat_message, list_team_chat_messages
from app.schemas.api import TeamChatMessageCreate
from app.services.colleague import enqueue_colleague_question


class TeamChatReplyTests(unittest.TestCase):
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
        self.other = self._user(self.other_workspace, "Other", "other@example.com")
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()
        self.temp_dir.cleanup()

    def _user(self, workspace: Workspace, name: str, email: str, **values: object) -> User:
        user = User(
            workspace_id=workspace.workspace_id,
            role="Member",
            display_name=name,
            email=email,
            password_hash="unused",
            is_active=True,
            **values,
        )
        self.db.add(user)
        self.db.flush()
        return user

    def test_reply_is_server_resolved_and_persists_for_regular_and_izge_messages(self) -> None:
        original = create_team_chat_message(
            TeamChatMessageCreate(body="Karar yarın netleşecek.", thread_id="company-general"),
            self.bob,
            self.db,
        )
        reply = create_team_chat_message(
            TeamChatMessageCreate(
                body="Takip ediyorum.",
                thread_id="company-general",
                reply_to_message_id=original.message_id,
                message_metadata={"reply_to": {"author_display_name": "Spoofed", "body": "Spoofed"}},
            ),
            self.alice,
            self.db,
        )
        self.assertEqual(original.message_id, reply.reply_to.message_id)
        self.assertEqual("Bob", reply.reply_to.author_display_name)
        self.assertEqual("Karar yarın netleşecek.", reply.reply_to.body)

        run = enqueue_colleague_question(
            self.db,
            actor=self.alice,
            message="@izge bunun etkisi nedir?",
            client_request_id="reply-to-company-message",
            thread_id="company-general",
            thread_title="Company General",
            thread_kind="channel",
            participant_user_ids=[],
            reply_to_message_id=original.message_id,
        )
        agent_question = self.db.scalar(select(CompanyChatMessage).where(
            CompanyChatMessage.message_metadata["colleague_run_id"].as_string() == run.run_id,
        ))
        self.assertEqual(original.message_id, agent_question.message_metadata["reply_to_message_id"])
        listed = list_team_chat_messages(80, self.alice, self.db)
        persisted = next(item for item in listed.messages if item.message_id == agent_question.message_id)
        self.assertEqual("Bob", persisted.reply_to.author_display_name)

    def test_reply_target_must_be_visible_and_in_the_same_thread(self) -> None:
        other_thread = create_team_chat_message(
            TeamChatMessageCreate(body="Başka konuşma", thread_id="other-thread"),
            self.bob,
            self.db,
        )
        hidden = CompanyChatMessage(
            workspace_id=self.workspace.workspace_id,
            author_user_id=self.bob.user_id,
            body="Gizli",
            message_metadata={
                "thread_id": "group:hidden",
                "thread_kind": "group",
                "participant_user_ids": [self.bob.user_id],
            },
        )
        other_workspace_message = CompanyChatMessage(
            workspace_id=self.other_workspace.workspace_id,
            author_user_id=self.other.user_id,
            body="Başka şirket",
            message_metadata={"thread_id": "company-general", "thread_kind": "channel"},
        )
        self.db.add_all([hidden, other_workspace_message])
        self.db.commit()

        for message_id in (other_thread.message_id, hidden.message_id, other_workspace_message.message_id, "msg_missing"):
            with self.subTest(message_id=message_id), self.assertRaises(HTTPException) as rejected:
                create_team_chat_message(
                    TeamChatMessageCreate(body="Yanıt", thread_id="company-general", reply_to_message_id=message_id),
                    self.alice,
                    self.db,
                )
            self.assertEqual(400, rejected.exception.status_code)

    def test_public_demo_persona_messages_are_marked_as_current_users_own(self) -> None:
        source_kerem = self._user(self.workspace, "Kerem Demir", "kerem@pusula.demo")
        demo_kerem = self._user(
            self.workspace,
            "Kerem Demir",
            "demo-kerem@public-demo.invalid",
            is_public_demo=True,
            public_demo_persona="kerem",
            public_demo_ip_hash="ip",
            public_demo_visitor_hash="visitor",
        )
        self.db.add(CompanyChatMessage(
            workspace_id=self.workspace.workspace_id,
            author_user_id=source_kerem.user_id,
            body="Benim eski mesajım",
            message_metadata={
                "thread_id": "company-general",
                "thread_kind": "channel",
                "participant_user_ids": [source_kerem.user_id],
                "seeded": True,
                "seed_batch": "pusula-b2b-demo-v1",
            },
        ))
        self.db.commit()

        message = list_team_chat_messages(80, demo_kerem, self.db).messages[0]
        self.assertTrue(message.is_authored_by_current_user)
        self.assertEqual(source_kerem.user_id, message.author_user_id)


if __name__ == "__main__":
    unittest.main()
