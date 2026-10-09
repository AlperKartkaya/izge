from __future__ import annotations

import json
import tempfile
import unittest
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine, delete, select
from sqlalchemy.orm import Session

from app.db import Base
from app.models import Artifact, ArtifactChunk, ArtifactPermission, ColleagueRun, ColleagueRunEvent, CompanyChatMessage, Signal, User, WorkTask, Workspace
from app.routers.team_chat import _message_is_visible_to_user, create_team_chat_message, list_team_chat_messages
from app.routers.work import _event_stream, _run_read, _task_read, _utc_naive, list_runs
from app.schemas.api import TeamChatMessageCreate
from app.schemas.work import WorkTaskCreate
from app.services.colleague import LocalLLMError, LostColleagueLeaseError, _recent_thread_context, _shared_signal_context, _stream_local_answer, _validate_answer_citations, add_run_event, claim_next_colleague_run, dispatch_due_reminders, enqueue_colleague_question, enqueue_due_evening_reviews, process_colleague_run, retrieve_shared_context


class ColleagueServiceTest(unittest.TestCase):
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

    def _artifact(self, title: str, text: str, visibility: str = "workspace") -> Artifact:
        artifact = Artifact(
            workspace_id=self.workspace.workspace_id,
            title=title,
            source_type="pasted_text",
            source_path=f"/{title}.txt",
            mime_type="text/plain",
            uploaded_by=self.alice.user_id,
            visibility_scope=visibility,
            extracted_text=text,
            ingestion_status="completed",
            review_status="approved",
        )
        self.db.add(artifact)
        self.db.flush()
        self.db.add(ArtifactChunk(artifact_id=artifact.artifact_id, workspace_id=self.workspace.workspace_id, sequence_number=0, text=text, chunk_metadata={}))
        self.db.flush()
        return artifact

    def _run(self, participants: list[str]) -> ColleagueRun:
        return enqueue_colleague_question(
            self.db,
            actor=self.alice,
            message="Bütçe kararı nedir?",
            client_request_id=f"request-{len(self.db.scalars(select(ColleagueRun)).all()) + 100}",
            thread_id="izge-colleague",
            thread_title="İzge",
            thread_kind="direct",
            participant_user_ids=participants,
        )

    def test_shared_retrieval_excludes_source_not_visible_to_every_recipient(self) -> None:
        public = self._artifact("Ortak plan", "Bütçe kararı ortak planda yer alıyor.")
        private = self._artifact("Gizli plan", "Bütçe kararı gizli zam bilgisini içeriyor.", "restricted")
        self.db.add(ArtifactPermission(workspace_id=self.workspace.workspace_id, artifact_id=private.artifact_id, user_id=self.alice.user_id, granted_by=self.alice.user_id))
        self.db.commit()

        run = self._run([self.bob.user_id])
        sources, _tasks = retrieve_shared_context(self.db, run)

        self.assertIn(public.artifact_id, {source["artifact_id"] for source in sources})
        self.assertNotIn(private.artifact_id, {source["artifact_id"] for source in sources})

    def test_regular_question_does_not_fall_back_to_unrelated_recent_sources(self) -> None:
        self._artifact("Bütçe", "Karar: reklam bütçesi artırıldı.")
        self.db.commit()
        run = enqueue_colleague_question(
            self.db,
            actor=self.alice,
            message="Kuantum sensörleri hakkında ne biliyoruz?",
            client_request_id="no-match-request",
            thread_id="izge-colleague",
            thread_title="İzge",
            thread_kind="direct",
            participant_user_ids=[],
        )
        sources, _tasks = retrieve_shared_context(self.db, run)
        self.assertEqual([], sources)

    def test_retrieval_keeps_full_evidence_and_prefers_first_chunk_over_equal_tail(self) -> None:
        evidence = "Atlas teslim kaydı\n" + "Çalışma bilgisi. " * 44 + "\nToplam 18 saat; saatlik 2.000 TL, potansiyel 36.000 TL."
        artifact = self._artifact("Atlas teslim kaydı", evidence)
        self.db.add(ArtifactChunk(artifact_id=artifact.artifact_id, workspace_id=self.workspace.workspace_id, sequence_number=1, text="özellik teslim edilmedi.", chunk_metadata={}))
        self.db.commit()
        run = self._run([self.bob.user_id])
        run.question = "Atlas teslim tutarı nedir?"
        self.db.commit()
        sources, _tasks = retrieve_shared_context(self.db, run)
        self.assertEqual(artifact.artifact_id, sources[0]["artifact_id"])
        self.assertIn("36.000 TL", sources[0]["quote"])

    def test_evening_review_keeps_other_company_topics_when_one_source_matches(self) -> None:
        risk = self._artifact("Müşteri riski", "Risk: destek sorunu devam ediyor.")
        tender = self._artifact("Teklif belgeleri", "İmzalı taahhüt belgesi kontrol edilecek.")
        self.db.commit()
        run = self._run([self.bob.user_id])
        run.kind = "evening_review"
        run.question = "Bugünkü riskleri ve yarın için takip edilecek işleri değerlendir."
        self.db.commit()
        sources, _ = retrieve_shared_context(self.db, run)
        self.assertEqual({risk.artifact_id, tender.artifact_id}, {source["artifact_id"] for source in sources})

    def test_evening_review_rechecks_sources_without_reusing_old_model_conclusions(self) -> None:
        old = self._run([self.bob.user_id])
        old.status = "completed"
        old.answer = "Önceki model sonucu."
        self.db.commit()
        current = self._run([self.bob.user_id])
        self.assertTrue(_recent_thread_context(self.db, current))
        current.kind = "evening_review"
        self.assertEqual([], _recent_thread_context(self.db, current))

    def test_evening_review_prioritizes_task_evidence_and_never_prompts_omitted_evidence(self) -> None:
        tender = self._artifact("Teklif dayanağı", "İmzalı belge tamamlanacak.")
        risks = [self._artifact(f"Risk notu {number}", "Risk: müşteri yanıt bekliyor.") for number in range(9)]
        task = WorkTask(workspace_id=self.workspace.workspace_id, created_by=self.alice.user_id,
                        title="Teklif belgesini tamamla", status="open", source_artifact_ids=[tender.artifact_id])
        self.db.add(task)
        self.db.add(WorkTask(workspace_id=self.workspace.workspace_id, created_by=self.alice.user_id,
                            title="Müşteri riskini incele", status="open", source_artifact_ids=[risks[0].artifact_id]))
        self.db.commit()
        run = self._run([self.bob.user_id])
        run.kind = "evening_review"
        run.question = "Risk notlarını ve açık işleri değerlendir."
        self.db.commit()
        sources, tasks = retrieve_shared_context(self.db, run)
        self.assertLessEqual(len(sources), 8)
        self.assertIn(task.task_id, {item["task_id"] for item in tasks})
        self.assertIn(tender.artifact_id, {source["artifact_id"] for source in sources})
        sources, tasks = retrieve_shared_context(self.db, run, artifact_limit=1)
        self.assertNotIn(task.task_id, {item["task_id"] for item in tasks})
        for item in tasks:
            prompted_task = self.db.get(WorkTask, item["task_id"])
            assert prompted_task is not None
            self.assertTrue(set(prompted_task.source_artifact_ids) <= {source["artifact_id"] for source in sources})

    def test_signal_with_nested_hidden_support_is_omitted(self) -> None:
        public = self._artifact("Ortak bütçe", "Bütçe kararı ortak kayıtta.")
        hidden = self._artifact("Gizli maaş", "Gizli maaş planı.", "restricted")
        self.db.add(ArtifactPermission(workspace_id=self.workspace.workspace_id, artifact_id=hidden.artifact_id, user_id=self.alice.user_id, granted_by=self.alice.user_id))
        signal = Signal(
            workspace_id=self.workspace.workspace_id,
            source_artifact_id=public.artifact_id,
            signal_type="assumption_drift",
            title="Bütçe riski",
            summary="Gizli destek kaydı var.",
            related_topic="budget",
            urgency_score=0.8,
            uncertainty_score=0.2,
            grounded_reasoning="İki kayıt karşılaştırıldı.",
            recommended_action="Gözden geçir.",
            payload_json={"nested": [{"supporting_artifact_ids": [public.artifact_id, hidden.artifact_id]}]},
            status="active",
        )
        self.db.add(signal)
        self.db.commit()
        run = self._run([self.bob.user_id])
        sources, _tasks = retrieve_shared_context(self.db, run)
        self.assertIn(public.artifact_id, {source["artifact_id"] for source in sources})
        self.assertEqual([], _shared_signal_context(self.db, run, sources))

    def test_revoked_source_redacts_persisted_answer_and_task_snapshot_is_not_prompt_context(self) -> None:
        private = self._artifact("Gizli plan", "Karar: gizli lansman planı.", "restricted")
        for user in (self.alice, self.bob):
            self.db.add(ArtifactPermission(workspace_id=self.workspace.workspace_id, artifact_id=private.artifact_id, user_id=user.user_id, granted_by=self.alice.user_id))
        task = WorkTask(
            workspace_id=self.workspace.workspace_id,
            created_by=self.alice.user_id,
            title="Planı uygula",
            description="Gizli lansman ayrıntısını uygula.",
            status="open",
            source_artifact_ids=[private.artifact_id],
            source_snapshot={private.artifact_id: {"title": "Gizli plan"}},
        )
        self.db.add(task)
        self.db.commit()
        run = self._run([self.bob.user_id])
        run.answer = "Gizli plan uygulanacak [1]."
        run.sources = [{"artifact_id": private.artifact_id, "title": private.title, "quote": private.extracted_text, "chunk_id": None}]
        run.status = "completed"
        self.db.commit()
        _sources, tasks = retrieve_shared_context(self.db, run)
        self.assertNotIn("source_snapshot", tasks[0])

        self.db.execute(delete(ArtifactPermission).where(ArtifactPermission.artifact_id == private.artifact_id, ArtifactPermission.user_id == self.bob.user_id))
        self.db.commit()
        _sources, tasks = retrieve_shared_context(self.db, run)
        self.assertEqual([], tasks)
        task_read = _task_read(self.db, self.bob, task, None)
        self.assertEqual("Erişimi kısıtlı iş", task_read.title)
        self.assertIsNone(task_read.description)
        self.assertEqual([], task_read.source_artifact_ids)
        read_model = _run_read(self.db, run, self.bob)
        self.assertEqual([], read_model.sources)
        self.assertIn("erişiminiz değişti", read_model.answer or "")

    def test_client_request_is_idempotent_but_cannot_be_reused_by_another_actor(self) -> None:
        first = enqueue_colleague_question(
            self.db,
            actor=self.alice,
            message="Plan nedir?",
            client_request_id="stable-request",
            thread_id="izge-colleague",
            thread_title="İzge",
            thread_kind="direct",
            participant_user_ids=[],
        )
        repeated = enqueue_colleague_question(
            self.db,
            actor=self.alice,
            message="Plan nedir?",
            client_request_id="stable-request",
            thread_id="izge-colleague",
            thread_title="İzge",
            thread_kind="direct",
            participant_user_ids=[],
        )
        self.assertEqual(first.run_id, repeated.run_id)
        self.assertEqual(1, len(self.db.scalars(select(CompanyChatMessage).where(CompanyChatMessage.message_metadata["client_request_id"].as_string() == "stable-request")).all()))

        with self.assertRaises(HTTPException) as raised:
            enqueue_colleague_question(
                self.db,
                actor=self.bob,
                message="Plan nedir?",
                client_request_id="stable-request",
                thread_id="izge-colleague",
                thread_title="İzge",
                thread_kind="direct",
                participant_user_ids=[],
            )
        self.assertEqual(409, raised.exception.status_code)

    def test_processing_persists_real_stream_events_and_agent_message(self) -> None:
        self._artifact("Bütçe lansman planı", "Bütçe kararıyla lansman kontrollü beta olarak devam edecek.")
        self.db.commit()
        run = self._run([])
        claimed = claim_next_colleague_run(self.db, worker_id="test-worker")
        self.assertIsNotNone(claimed)

        with patch("app.services.colleague._stream_local_answer", return_value=iter(["Kontrollü ", "beta sürecek [1]."])):
            completed = process_colleague_run(self.db, claimed)  # type: ignore[arg-type]

        self.assertEqual("completed", completed.status)
        self.assertEqual("Kontrollü beta sürecek [1].", completed.answer)
        event_types = [event.event_type for event in self.db.scalars(select(ColleagueRunEvent).where(ColleagueRunEvent.run_id == run.run_id).order_by(ColleagueRunEvent.sequence)).all()]
        self.assertIn("delta", event_types)
        self.assertEqual("done", event_types[-1])
        assistant_message = self.db.scalar(select(CompanyChatMessage).where(CompanyChatMessage.author_user_id != self.alice.user_id).order_by(CompanyChatMessage.created_at.desc()))
        if assistant_message is None:
            self.fail("Agent message was not persisted")
        self.assertEqual(completed.answer, assistant_message.body)
        with patch("app.services.colleague._stream_local_answer", return_value=iter(["Kontrollü beta sürecek [1]."])):
            process_colleague_run(self.db, completed)
        assistant_messages = [
            message
            for message in self.db.scalars(select(CompanyChatMessage).where(CompanyChatMessage.author_user_id != self.alice.user_id)).all()
            if (message.message_metadata or {}).get("colleague_run_id") == run.run_id
        ]
        self.assertEqual(1, len(assistant_messages))

    def test_expired_run_is_atomically_reclaimed_with_reset_and_heartbeat(self) -> None:
        run = self._run([])
        run.status = "running"
        run.lease_owner = "dead-worker"
        run.lease_expires_at = datetime.utcnow() - timedelta(seconds=1)
        self.db.commit()
        claimed = claim_next_colleague_run(self.db, worker_id="new-worker", lease_seconds=1)
        if claimed is None:
            self.fail("Expired run was not reclaimed")
        reset = self.db.scalar(select(ColleagueRunEvent).where(ColleagueRunEvent.run_id == run.run_id, ColleagueRunEvent.event_type == "reset"))
        self.assertIsNotNone(reset)
        first_lease = claimed.lease_expires_at
        add_run_event(self.db, claimed, "stage", stage_key="thinking", label="Yanıt hazırlanıyor", payload={"status": "running"})
        if first_lease is None or claimed.lease_expires_at is None:
            self.fail("Claim lease was not persisted")
        self.assertGreater(claimed.lease_expires_at, first_lease)
        with Session(self.engine) as other_db:
            self.assertIsNone(claim_next_colleague_run(other_db, worker_id="other-worker"))

    def test_reclaimed_run_rejects_stale_worker_writes_and_hides_old_attempt_events(self) -> None:
        private = self._artifact("Gizli teklif", "Sızmaması gereken fiyat", "restricted")
        self.db.add(ArtifactPermission(workspace_id=self.workspace.workspace_id, artifact_id=private.artifact_id, user_id=self.alice.user_id, granted_by=self.alice.user_id))
        self.db.commit()
        run = self._run([self.bob.user_id])
        claimed_a = claim_next_colleague_run(self.db, worker_id="worker-a", lease_seconds=30)
        if claimed_a is None or claimed_a.lease_owner is None:
            self.fail("Run was not claimed by worker A")
        owner_a = claimed_a.lease_owner
        add_run_event(
            self.db,
            claimed_a,
            "source",
            payload={"source": {"artifact_id": private.artifact_id, "title": private.title, "quote": private.extracted_text}},
            lease_owner=owner_a,
        )
        add_run_event(self.db, claimed_a, "delta", text="Sızmaması gereken fiyat", lease_owner=owner_a)

        with Session(self.engine, expire_on_commit=False) as other_db:
            current = other_db.get(ColleagueRun, run.run_id)
            if current is None:
                self.fail("Run disappeared")
            current.lease_expires_at = datetime.utcnow() - timedelta(seconds=1)
            other_db.commit()
            claimed_b = claim_next_colleague_run(other_db, worker_id="worker-b")
            if claimed_b is None:
                self.fail("Run was not reclaimed by worker B")
            self.assertNotEqual(owner_a, claimed_b.lease_owner)

        with self.assertRaises(LostColleagueLeaseError):
            add_run_event(self.db, claimed_a, "delta", text="eski işlemci", lease_owner=owner_a)
        current_after_stale_process = process_colleague_run(self.db, claimed_a, lease_owner=owner_a)
        self.assertEqual("running", current_after_stale_process.status)
        self.assertTrue((current_after_stale_process.lease_owner or "").startswith("worker-b:"))

        with Session(self.engine) as other_db:
            current = other_db.get(ColleagueRun, run.run_id)
            if current is None:
                self.fail("Run disappeared")
            current.status = "completed"
            current.lease_owner = None
            current.lease_expires_at = None
            other_db.commit()
        with patch("app.routers.work.SessionLocal", side_effect=lambda: Session(self.engine)):
            replay = "".join(_event_stream(run.run_id, 0, self.bob.user_id))
        self.assertIn('event: reset', replay)
        self.assertNotIn("Sızmaması gereken fiyat", replay)

        public = self._artifact("Ortak teklif", "Herkese açık fiyat")
        mismatched_run = ColleagueRun(
            workspace_id=self.workspace.workspace_id,
            created_by=self.alice.user_id,
            kind="ask",
            client_request_id="mismatched-event-source",
            thread_id="izge-colleague",
            thread_title="İzge",
            thread_kind="direct",
            participant_user_ids=[self.alice.user_id, self.bob.user_id],
            question="Teklif nedir?",
            status="completed",
            sources=[{"artifact_id": public.artifact_id, "title": public.title, "quote": public.extracted_text}],
        )
        self.db.add(mismatched_run)
        self.db.flush()
        self.db.add(ColleagueRunEvent(run_id=mismatched_run.run_id, sequence=1, event_type="source", payload={"source": {"artifact_id": private.artifact_id, "title": private.title, "quote": private.extracted_text}}))
        self.db.commit()
        with patch("app.routers.work.SessionLocal", side_effect=lambda: Session(self.engine)):
            mismatched_replay = "".join(_event_stream(mismatched_run.run_id, 0, self.bob.user_id))
        self.assertEqual("", mismatched_replay)

    def test_evening_review_is_idempotent_and_group_messages_use_real_user_ids(self) -> None:
        after_five_pm_istanbul = datetime(2026, 10, 8, 15, 0, tzinfo=UTC)
        self.assertEqual(1, enqueue_due_evening_reviews(self.db, after_five_pm_istanbul))
        self.assertEqual(0, enqueue_due_evening_reviews(self.db, after_five_pm_istanbul))
        run = self.db.scalar(select(ColleagueRun).where(ColleagueRun.kind == "evening_review"))
        if run is None:
            self.fail("Evening review was not queued")
        self.assertIn(self.alice.user_id, run.participant_user_ids)
        self.assertIn(self.bob.user_id, run.participant_user_ids)

        message = CompanyChatMessage(
            workspace_id=self.workspace.workspace_id,
            author_user_id=self.alice.user_id,
            body="Özel",
            message_metadata={"thread_kind": "group", "participant_user_ids": [self.alice.user_id]},
        )
        self.assertTrue(_message_is_visible_to_user(message, self.alice))
        self.assertFalse(_message_is_visible_to_user(message, self.bob))

    def test_evening_review_ingests_only_unfinished_artifacts(self) -> None:
        completed = self._artifact("İşlenmiş", "Karar: tamamlandı.")
        pending = self._artifact("Yeni", "Karar: yeni kayıt.")
        completed.ingestion_status = "completed"
        pending.ingestion_status = "pending"
        self.db.commit()
        enqueue_due_evening_reviews(self.db, datetime(2026, 10, 8, 15, 0, tzinfo=UTC))
        run = self.db.scalar(select(ColleagueRun).where(ColleagueRun.kind == "evening_review"))
        self.assertIsNotNone(run)
        claimed = claim_next_colleague_run(self.db, worker_id="review-worker")
        self.assertIsNotNone(claimed)

        with (
            patch("app.services.ingestion.run_ingestion") as ingest,
            patch("app.services.temporal_graph.sync_temporal_claims", return_value={"family_count": 1, "occurrence_count": 1, "synced": True}),
            patch("app.services.colleague._stream_local_answer", return_value=iter(["Gün sonu özeti [1]."])),
        ):
            process_colleague_run(self.db, claimed)  # type: ignore[arg-type]

        self.assertEqual(1, ingest.call_count)
        self.assertEqual(pending.artifact_id, ingest.call_args.kwargs["artifact"].artifact_id)

    def test_reminders_are_idempotent_and_timezone_inputs_are_normalized(self) -> None:
        local_due = datetime(2026, 10, 9, 9, 0, tzinfo=timezone(timedelta(hours=3)))
        self.assertEqual(datetime(2026, 10, 9, 6, 0), _utc_naive(local_due))
        task = WorkTask(
            workspace_id=self.workspace.workspace_id,
            created_by=self.alice.user_id,
            assignee_user_id=self.bob.user_id,
            title="Müşteri notlarını kontrol et",
            status="open",
            due_at=datetime(2026, 10, 9, 6, 0),
            remind_at=datetime(2026, 10, 9, 6, 0),
            source_artifact_ids=[],
            source_snapshot={},
        )
        self.db.add(task)
        self.db.commit()
        now = datetime(2026, 10, 9, 6, 1, tzinfo=UTC)
        self.assertEqual(1, dispatch_due_reminders(self.db, now))
        self.assertEqual(0, dispatch_due_reminders(self.db, now))
        reminder_messages = [
            message
            for message in self.db.scalars(select(CompanyChatMessage)).all()
            if (message.message_metadata or {}).get("source") == "izge-reminder"
        ]
        self.assertEqual(1, len(reminder_messages))
        self.assertIn("09:00", reminder_messages[0].body)
        with self.assertRaises(ValidationError):
            WorkTaskCreate(title="Saat dilimsiz", due_at=datetime(2026, 10, 9, 9, 0))

    def test_reminder_redacts_source_derived_title_from_assignee_without_access(self) -> None:
        private = self._artifact("Gizli müşteri", "Gizli yenileme teklifi", "restricted")
        self.db.add(ArtifactPermission(workspace_id=self.workspace.workspace_id, artifact_id=private.artifact_id, user_id=self.alice.user_id, granted_by=self.alice.user_id))
        task = WorkTask(
            workspace_id=self.workspace.workspace_id,
            created_by=self.alice.user_id,
            assignee_user_id=self.bob.user_id,
            title="Acme gizli indirimini gönder",
            status="open",
            remind_at=datetime(2026, 10, 9, 6, 0),
            source_artifact_ids=[private.artifact_id],
            source_snapshot={private.artifact_id: {"title": private.title}},
        )
        self.db.add(task)
        self.db.commit()

        self.assertEqual(1, dispatch_due_reminders(self.db, datetime(2026, 10, 9, 6, 1, tzinfo=UTC)))
        reminder = self.db.scalar(select(CompanyChatMessage).where(CompanyChatMessage.message_metadata["task_id"].as_string() == task.task_id))
        if reminder is None:
            self.fail("Reminder was not created")
        self.assertIn("Erişimi kısıtlı iş", reminder.body)
        self.assertNotIn("Acme", reminder.body)

    def test_ollama_eof_without_done_is_a_failure(self) -> None:
        class FakeResponse:
            status = 200

            def __init__(self) -> None:
                self.lines = iter([b'{"message":{"content":"yarim"}}\n', b""])

            def readline(self) -> bytes:
                return next(self.lines)

        class FakeConnection:
            def request(self, *_args, **_kwargs) -> None:
                self.payload = json.loads(_kwargs["body"])

            def getresponse(self) -> FakeResponse:
                return FakeResponse()

            def close(self) -> None:
                return None

        connection = FakeConnection()
        settings = SimpleNamespace(local_llm_enabled=True, local_llm_model="test", local_llm_timeout_seconds=1)
        with (
            patch("app.services.colleague.get_settings", return_value=settings),
            patch("app.services.colleague.validated_local_llm_base_url", return_value="http://127.0.0.1:11434"),
            patch("app.services.colleague.http.client.HTTPConnection", return_value=connection),
        ):
            with self.assertRaises(LocalLLMError):
                list(_stream_local_answer("soru", [], [], review=False))
        self.assertIn("Onay bekleyen tutarı yanıtın hiçbir bölümünde kesinleşmiş alacak", connection.payload["messages"][0]["content"])

    def test_malformed_ollama_line_and_invalid_citations_fail_closed(self) -> None:
        class BadResponse:
            status = 200

            def readline(self) -> bytes:
                return b"not-json\n"

        class BadConnection:
            def request(self, *_args, **_kwargs) -> None: return None
            def getresponse(self) -> BadResponse: return BadResponse()
            def close(self) -> None: return None

        settings = SimpleNamespace(local_llm_enabled=True, local_llm_model="test", local_llm_timeout_seconds=1)
        with (
            patch("app.services.colleague.get_settings", return_value=settings),
            patch("app.services.colleague.validated_local_llm_base_url", return_value="http://127.0.0.1:11434"),
            patch("app.services.colleague.http.client.HTTPConnection", return_value=BadConnection()),
            self.assertRaises(LocalLLMError),
        ):
            list(_stream_local_answer("soru", [], [], review=False))
        with self.assertRaises(LocalLLMError):
            _validate_answer_citations("Kaynak yok [1].", [])
        with self.assertRaises(LocalLLMError):
            _validate_answer_citations("Atıfsız yanıt.", [{"artifact_id": "art_1"}])
        with self.assertRaises(LocalLLMError):
            _validate_answer_citations("Geçersiz [2].", [{"artifact_id": "art_1"}])

    def test_new_private_threads_require_real_participants(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            create_team_chat_message(TeamChatMessageCreate(body="Gizli", thread_id="direct:new", thread_kind="direct"), self.alice, self.db)
        self.assertEqual(422, raised.exception.status_code)
        created = create_team_chat_message(
            TeamChatMessageCreate(
                body="Merhaba",
                thread_id=f"direct:{self.alice.user_id}:{self.bob.user_id}",
                thread_kind="direct",
                message_metadata={"participant_user_ids": [self.bob.user_id]},
            ),
            self.alice,
            self.db,
        )
        self.assertEqual({self.alice.user_id, self.bob.user_id}, set(created.message_metadata["participant_user_ids"]))

    def test_legacy_group_without_any_recipients_fails_closed(self) -> None:
        message = CompanyChatMessage(
            workspace_id=self.workspace.workspace_id,
            author_user_id=self.alice.user_id,
            body="Yanlışlıkla alıcısız",
            message_metadata={"thread_kind": "group"},
        )
        self.assertFalse(_message_is_visible_to_user(message, self.bob))

    def test_private_history_cannot_hide_older_visible_messages_or_runs(self) -> None:
        visible_message = CompanyChatMessage(workspace_id=self.workspace.workspace_id, author_user_id=self.bob.user_id, body="Görünür", message_metadata={"thread_kind": "channel"})
        self.db.add(visible_message)
        self.db.flush()
        for index in range(3):
            self.db.add(CompanyChatMessage(workspace_id=self.workspace.workspace_id, author_user_id=self.bob.user_id, body=f"Gizli {index}", message_metadata={"thread_kind": "group", "participant_user_ids": [self.bob.user_id]}))
        visible_run = ColleagueRun(workspace_id=self.workspace.workspace_id, created_by=self.alice.user_id, kind="ask", client_request_id="visible-history", thread_id="izge-colleague", thread_title="İzge", thread_kind="direct", participant_user_ids=[self.alice.user_id], question="Görünür", status="queued", sources=[])
        self.db.add(visible_run)
        self.db.flush()
        for index in range(3):
            self.db.add(ColleagueRun(workspace_id=self.workspace.workspace_id, created_by=self.bob.user_id, kind="ask", client_request_id=f"hidden-history-{index}", thread_id="private", thread_title="Özel", thread_kind="direct", participant_user_ids=[self.bob.user_id], question="Gizli", status="queued", sources=[]))
        self.db.commit()
        messages = list_team_chat_messages(1, self.alice, self.db)
        self.assertEqual(["Görünür"], [message.body for message in messages.messages])
        runs = list_runs(1, self.alice, self.db)
        self.assertEqual([visible_run.run_id], [item.run_id for item in runs.items])


if __name__ == "__main__":
    unittest.main()
