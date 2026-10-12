from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from app.config import Settings
from app.services.agent_policy import AgentPlan
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine, delete, select
from sqlalchemy.orm import Session

from app.db import Base
from app.models import Artifact, ArtifactChunk, ArtifactPermission, ColleagueRun, CompanyChatMessage, Notification, User, Workspace
from app.routers.notifications import _read, delete_notification, get_notification, list_notifications, mark_notification_read, mark_notification_unread
from app.routers.artifacts import create_pasted_text_artifact
from app.routers.team_chat import create_team_chat_message, list_team_chat_messages
from app.routers.work import list_runs
from app.routers.users import list_colleagues
from app.schemas.api import PastedTextCreate, TeamChatMessageCreate
from app.services.colleague import (
    _evaluate_artifact_review,
    _generate_follow_ups,
    _notification_preview,
    claim_next_colleague_run,
    enqueue_artifact_review,
    enqueue_colleague_question,
    process_colleague_run,
    retrieve_shared_context,
)
from app.services.llm import LocalLLMError
from app.services.notifications import create_notification


class NotificationFlowTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.engine = create_engine(f"sqlite:///{Path(self.temp_dir.name) / 'test.db'}")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine, expire_on_commit=False)
        self.workspace = Workspace(name="Test", description="")
        self.other_workspace = Workspace(name="Other", description="")
        self.db.add_all([self.workspace, self.other_workspace])
        self.db.flush()
        self.alice = self._user(self.workspace, "Alice", "alice-notify@example.com")
        self.bob = self._user(self.workspace, "Bob", "bob-notify@example.com")
        self.carol = self._user(self.workspace, "Carol", "carol-notify@example.com")
        self.outsider = self._user(self.other_workspace, "Outsider", "outsider-notify@example.com")
        self.db.commit()
        planner = patch("app.services.colleague._plan_agent_work", return_value=AgentPlan(intent="company", summary="Kanıtları karşılaştır", web_query="", mcp_reads=[], reviewer=False))
        planner.start()
        self.addCleanup(planner.stop)

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()
        self.temp_dir.cleanup()

    def _user(self, workspace: Workspace, name: str, email: str) -> User:
        user = User(
            workspace_id=workspace.workspace_id,
            role="Member",
            display_name=name,
            email=email,
            password_hash="unused",
            is_active=True,
        )
        self.db.add(user)
        self.db.flush()
        return user

    def _artifact(self, title: str, text: str) -> Artifact:
        artifact = Artifact(
            workspace_id=self.workspace.workspace_id,
            title=title,
            source_type="pasted_text",
            source_path=f"/{title}.txt",
            mime_type="text/plain",
            uploaded_by=self.alice.user_id,
            visibility_scope="workspace",
            extracted_text=text,
            ingestion_status="completed",
            review_status="approved",
        )
        self.db.add(artifact)
        self.db.flush()
        self.db.add(ArtifactChunk(
            artifact_id=artifact.artifact_id,
            workspace_id=self.workspace.workspace_id,
            sequence_number=0,
            text=text,
            chunk_metadata={},
        ))
        self.db.commit()
        return artifact

    def test_private_message_notifies_only_other_participants_and_read_is_isolated(self) -> None:
        created = create_team_chat_message(
            TeamChatMessageCreate(
                body="Müşteri sözleşmesini kontrol eder misin?",
                thread_id=f"direct:{self.alice.user_id}:{self.bob.user_id}",
                thread_title="Alice / Bob",
                thread_kind="direct",
                message_metadata={"participant_user_ids": [self.bob.user_id]},
            ),
            self.alice,
            self.db,
        )
        notifications = list(self.db.scalars(select(Notification)).all())
        self.assertEqual([self.bob.user_id], [item.recipient_user_id for item in notifications])
        self.assertEqual(created.message_id, notifications[0].message_id)
        self.assertEqual(0, list_notifications(50, False, self.alice, self.db).unread_count)
        bob_list = list_notifications(50, False, self.bob, self.db)
        self.assertEqual(1, bob_list.unread_count)
        with self.assertRaises(HTTPException) as raised:
            get_notification(notifications[0].notification_id, self.carol, self.db)
        self.assertEqual(404, raised.exception.status_code)
        with self.assertRaises(HTTPException) as raised:
            mark_notification_read(notifications[0].notification_id, self.carol, self.db)
        self.assertEqual(404, raised.exception.status_code)
        read = mark_notification_read(notifications[0].notification_id, self.bob, self.db)
        self.assertIsNotNone(read.read_at)
        self.assertEqual(0, list_notifications(50, False, self.bob, self.db).unread_count)
        unread = mark_notification_unread(notifications[0].notification_id, self.bob, self.db)
        self.assertIsNone(unread.read_at)
        with self.assertRaises(HTTPException) as raised:
            delete_notification(notifications[0].notification_id, self.carol, self.db)
        self.assertEqual(404, raised.exception.status_code)
        delete_notification(notifications[0].notification_id, self.bob, self.db)
        self.assertIsNone(self.db.get(Notification, notifications[0].notification_id))

    def test_notification_body_keeps_complete_markdown_for_expansion(self) -> None:
        body = "## Durum\n\n" + ("Uzun bildirim satırı. " * 90) + "\n\n**Son öneri**"
        create_team_chat_message(
            TeamChatMessageCreate(
                body=body,
                thread_id=f"direct:{self.alice.user_id}:{self.bob.user_id}",
                thread_title="Alice / Bob",
                thread_kind="direct",
                message_metadata={"participant_user_ids": [self.bob.user_id]},
            ),
            self.alice,
            self.db,
        )
        notification = list_notifications(50, False, self.bob, self.db).items[0]
        self.assertLessEqual(len(notification.body), 321)
        self.assertEqual(body, get_notification(notification.notification_id, self.bob, self.db).body)
        self.assertLessEqual(len(_notification_preview(body)), 1200)
        linked = self.db.get(Notification, notification.notification_id)
        self.assertIsNotNone(linked)
        if linked is None:
            self.fail("Notification was not persisted")
        self.assertLessEqual(len(linked.body), 1200)
        linked.body = body[:1200]
        self.db.commit()
        self.assertEqual(body, _read(linked, self.db, self.bob).body)
        run = ColleagueRun(
            workspace_id=self.workspace.workspace_id,
            created_by=self.alice.user_id,
            kind="evening_review",
            client_request_id="legacy-notification-run",
            thread_id="izge-colleague",
            thread_title="İzge",
            participant_user_ids=[self.bob.user_id],
            question="Değerlendir",
            status="completed",
            answer=body,
        )
        self.db.add(run)
        self.db.flush()
        legacy = Notification(
            workspace_id=self.workspace.workspace_id,
            recipient_user_id=self.bob.user_id,
            kind="agent",
            title="Eski bildirim",
            body=body[:1200],
            source_key="legacy:truncated",
            thread_id=run.thread_id,
            run_id=run.run_id,
        )
        self.db.add(legacy)
        self.db.commit()
        self.assertEqual(body, _read(legacy, self.db, self.bob).body)
        self.assertEqual(body, get_notification(legacy.notification_id, self.bob, self.db).body)

    def test_standalone_notification_keeps_its_only_complete_copy(self) -> None:
        body = "Bağımsız bildirim. " * 100
        standalone = create_notification(
            self.db,
            recipient=self.bob,
            kind="agent",
            title="Bağımsız",
            body=body,
            source_key="standalone:complete",
        )
        self.db.commit()
        self.assertEqual(body, standalone.body)
        listed = next(item for item in list_notifications(50, False, self.bob, self.db).items if item.notification_id == standalone.notification_id)
        self.assertLessEqual(len(listed.body), 321)
        self.assertEqual(body, get_notification(standalone.notification_id, self.bob, self.db).body)

    def test_scoped_channel_notifies_only_explicit_participants(self) -> None:
        create_team_chat_message(
            TeamChatMessageCreate(
                body="Yalnız teklif ekibi için",
                thread_id="proposal-team",
                thread_title="Teklif Ekibi",
                thread_kind="channel",
                message_metadata={"participant_user_ids": [self.bob.user_id]},
            ),
            self.alice,
            self.db,
        )
        recipients = {item.recipient_user_id for item in self.db.scalars(select(Notification)).all()}
        self.assertEqual({self.bob.user_id}, recipients)

    def test_izge_mention_notifies_human_participants_once_and_commits(self) -> None:
        run_ids = [enqueue_colleague_question(
            self.db, actor=self.alice, message="@izge teklifi kontrol et", client_request_id="mention-notify",
            thread_id="proposal-team", thread_title="Teklif ekibi", thread_kind="group",
            participant_user_ids=[self.bob.user_id],
        ).run_id for _ in range(2)]
        self.assertEqual(run_ids[0], run_ids[1])
        with Session(self.engine) as reader:
            notifications = list(reader.scalars(select(Notification)).all())
            self.assertEqual([self.bob.user_id], [item.recipient_user_id for item in notifications])
            self.assertEqual("@izge teklifi kontrol et", notifications[0].body)
            self.assertIsNotNone(reader.get(CompanyChatMessage, notifications[0].message_id))
        claimed = claim_next_colleague_run(self.db, worker_id="mention-worker")
        with (
            patch("app.services.colleague._stream_local_answer", return_value=iter(["İşi Selin'e aktaralım."])),
            patch("app.services.colleague._safe_follow_ups", return_value=[]),
        ):
            self.assertEqual("completed", process_colleague_run(self.db, claimed).status)  # type: ignore[arg-type]
        with Session(self.engine) as reader:
            notifications = list(reader.scalars(select(Notification)).all())
            self.assertEqual(3, len(notifications))
            self.assertEqual(2, sum(item.recipient_user_id == self.bob.user_id for item in notifications))
            self.assertEqual(1, sum(item.recipient_user_id == self.alice.user_id for item in notifications))
            self.assertTrue(all(item.kind == "message" for item in notifications))

    def test_team_lead_admin_is_a_colleague_and_receives_team_notifications(self) -> None:
        self.bob.role = "Admin"
        self.carol.is_active = False
        self.db.commit()
        colleagues = list_colleagues(self.alice, self.db)
        self.assertEqual([self.bob.user_id], [user.user_id for user in colleagues])
        create_team_chat_message(TeamChatMessageCreate(
            body="Team Lead onayını bekliyorum.", thread_id="company-general", thread_kind="channel",
            message_metadata={"participant_user_ids": [user.user_id for user in colleagues]},
        ), self.alice, self.db)
        with Session(self.engine) as reader:
            self.assertEqual([self.bob.user_id], list(reader.scalars(select(Notification.recipient_user_id)).all()))

    def test_review_distinguishes_new_record_and_rejects_unrelated_old_evidence(self) -> None:
        uploaded = self._artifact("Yeni not", "Sıradan bilgi notu.")
        existing = self._artifact("Eski risk", "Önceden bilinen müşteri riski.")
        run = enqueue_artifact_review(self.db, artifact=uploaded, actor=self.alice)
        sources = [dict(artifact_id=uploaded.artifact_id, title=uploaded.title, quote=uploaded.extracted_text),
                   dict(artifact_id=existing.artifact_id, title=existing.title, quote=existing.extracted_text)]
        with patch("app.services.colleague._structured_local_output", return_value=dict(should_notify=False, title="", summary="")) as model:
            self.assertEqual((False, "", ""), _evaluate_artifact_review(run, sources))
        self.assertIn("[1] YENİ KAYIT", model.call_args.kwargs["user_prompt"])
        self.assertIn("[2] MEVCUT KAYIT", model.call_args.kwargs["user_prompt"])
        with patch("app.services.colleague._structured_local_output", return_value=dict(should_notify=True, title="Eski risk", summary="Mevcut risk var [2].")):
            with self.assertRaises(LocalLLMError):
                _evaluate_artifact_review(run, sources)

    def test_successful_pasted_text_ingestion_queues_artifact_review(self) -> None:
        with (
            patch("app.routers.artifacts.persist_pasted_text", return_value=("/tmp/demo.txt", "abc")),
            patch("app.routers.artifacts._feed_memory_inline", return_value=True),
            patch("app.routers.artifacts._queue_artifact_review") as queue_review,
        ):
            created = create_pasted_text_artifact(
                PastedTextCreate(title="Yeni şartname", text="Zorunlu belge listesi"),
                self.alice,
                self.db,
            )
        self.assertEqual(created.artifact_id, queue_review.call_args.args[1].artifact_id)
        self.assertEqual(self.alice.user_id, queue_review.call_args.args[2].user_id)

    def test_artifact_review_positive_creates_one_private_message_and_notification(self) -> None:
        existing = self._artifact("Teklif şartları", "Teklifte imzalı KVKK taahhüdü zorunludur.")
        uploaded = self._artifact("Hazırlanan teklif", "Teklif eki listesinde KVKK taahhüdü bulunmuyor.")
        uploaded.visibility_scope = "restricted"
        self.db.add(ArtifactPermission(
            workspace_id=self.workspace.workspace_id,
            artifact_id=uploaded.artifact_id,
            user_id=self.bob.user_id,
            granted_by=self.alice.user_id,
        ))
        self.db.commit()
        run = enqueue_artifact_review(self.db, artifact=uploaded, actor=self.bob)
        repeated = enqueue_artifact_review(self.db, artifact=uploaded, actor=self.bob)
        self.assertEqual(run.run_id, repeated.run_id)
        claimed = claim_next_colleague_run(self.db, worker_id="review-worker")
        self.assertIsNotNone(claimed)
        with (
            patch(
                "app.services.colleague._evaluate_artifact_review",
                return_value=(True, "Teklifte zorunlu belge eksik", "KVKK taahhüdü zorunlu [1], hazırlanan ekte bulunmuyor [2]."),
            ),
            patch("app.services.colleague._safe_follow_ups", return_value=["Eksik belgeyi kim tamamlayacak?"]),
        ):
            completed = process_colleague_run(self.db, claimed)  # type: ignore[arg-type]
        self.assertEqual("completed", completed.status)
        self.assertEqual(["Eksik belgeyi kim tamamlayacak?"], completed.follow_ups)
        self.assertEqual(uploaded.artifact_id, completed.context_artifact_ids[0])
        self.assertIn(existing.artifact_id, {source["artifact_id"] for source in completed.sources})
        notification = self.db.scalar(select(Notification).where(Notification.run_id == run.run_id))
        self.assertIsNotNone(notification)
        if notification is None:
            self.fail("Notification was not persisted")
        self.assertEqual(self.bob.user_id, notification.recipient_user_id)
        self.assertNotIn("[1]", notification.body)
        message = self.db.scalar(select(CompanyChatMessage).where(CompanyChatMessage.message_id == notification.message_id))
        self.assertIsNotNone(message)
        self.assertEqual(run.thread_id, (message.message_metadata or {}).get("thread_id"))  # type: ignore[union-attr]

        self.db.execute(delete(ArtifactPermission).where(
            ArtifactPermission.artifact_id == uploaded.artifact_id,
            ArtifactPermission.user_id == self.bob.user_id,
        ))
        self.db.commit()
        redacted = list_notifications(50, False, self.bob, self.db).items[0]
        self.assertIn("erişiminiz değişti", redacted.body)
        self.assertIn("erişiminiz değişti", get_notification(notification.notification_id, self.bob, self.db).body)
        redacted_run = list_runs(40, self.bob, self.db, run.thread_id).items[0]
        self.assertEqual("Yeni kayıt değerlendirildi.", redacted_run.question)
        self.assertEqual("İzge ile çalışma", redacted_run.thread_title)
        self.assertEqual([], redacted_run.follow_ups)
        redacted_message = next(
            item for item in list_team_chat_messages(80, self.bob, self.db).messages
            if item.message_id == notification.message_id
        )
        self.assertIn("erişiminiz değişti", redacted_message.body)
        self.assertEqual([], redacted_message.message_metadata["follow_ups"])

    def test_notification_thread_follow_up_inherits_authorized_context(self) -> None:
        uploaded = self._artifact("Müşteri talebi", "Müşteri rapor dışa aktarımını istedi; henüz sorumlusu yok.")
        alert = enqueue_artifact_review(self.db, artifact=uploaded, actor=self.alice)
        claimed = claim_next_colleague_run(self.db, worker_id="review-worker")
        with (
            patch(
                "app.services.colleague._evaluate_artifact_review",
                return_value=(True, "Sahipsiz müşteri talebi", "Rapor dışa aktarım talebinin sorumlusu yok [1]."),
            ),
            patch("app.services.colleague._safe_follow_ups", return_value=[]),
        ):
            process_colleague_run(self.db, claimed)  # type: ignore[arg-type]

        follow_up = enqueue_colleague_question(
            self.db,
            actor=self.alice,
            message="Bunu kim üstlenebilir?",
            client_request_id="notification-follow-up",
            thread_id=alert.thread_id,
            thread_title=alert.thread_title,
            thread_kind="direct",
            participant_user_ids=[],
        )
        sources, _tasks = retrieve_shared_context(self.db, follow_up)
        self.assertIn(uploaded.artifact_id, {source["artifact_id"] for source in sources})
        thread_runs = list_runs(40, self.alice, self.db, alert.thread_id)
        self.assertEqual({alert.run_id, follow_up.run_id}, {item.run_id for item in thread_runs.items})
        follow_up_claim = claim_next_colleague_run(self.db, worker_id="follow-up-worker")
        with (
            patch("app.services.colleague._stream_local_answer", return_value=iter(["Önce sorumlu atanmalı [1]."])),
            patch("app.services.colleague._safe_follow_ups", return_value=[]),
        ):
            completed = process_colleague_run(self.db, follow_up_claim)  # type: ignore[arg-type]
        self.assertEqual("completed", completed.status)

    def test_artifact_review_negative_does_not_create_message_or_notification(self) -> None:
        uploaded = self._artifact("Bilgi notu", "Bu kayıt önceki planla uyumludur.")
        run = enqueue_artifact_review(self.db, artifact=uploaded, actor=self.alice)
        claimed = claim_next_colleague_run(self.db, worker_id="review-worker")
        with patch("app.services.colleague._evaluate_artifact_review", return_value=(False, "", "")):
            completed = process_colleague_run(self.db, claimed)  # type: ignore[arg-type]
        self.assertEqual("completed", completed.status)
        self.assertIsNone(self.db.scalar(select(Notification).where(Notification.run_id == run.run_id)))
        self.assertIsNone(self.db.scalar(select(CompanyChatMessage).where(CompanyChatMessage.message_metadata["colleague_run_id"].as_string() == run.run_id)))

    def test_follow_up_uses_json_schema_and_rejects_invalid_items(self) -> None:
        with patch("app.services.colleague.structured_agent_output", return_value={"follow_ups": ["Sorumlu kişi kim?", "Son tarih nedir?"]}) as structured:
            follow_ups = _generate_follow_ups("Durum nedir?", "Eksik belge var [1].", [{"title": "Şartname", "quote": "Belge zorunlu"}])
        self.assertEqual(["Sorumlu kişi kim?", "Son tarih nedir?"], follow_ups)
        self.assertEqual("object", structured.call_args.kwargs["schema"]["type"])


if __name__ == "__main__":
    unittest.main()
