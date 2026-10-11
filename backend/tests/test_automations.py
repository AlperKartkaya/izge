import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.db import Base
from app.models import ColleagueRun, User, Workspace
from app.models.automation import Automation
from app.routers.automations import create_automation, delete_automation, list_automations, run_automation, update_automation
from app.schema import ensure_legacy_schema_compatibility
from app.schemas.automation import AutomationCreate, AutomationUpdate
from app.services.automations import dispatch_due_automations, next_run_at


class AutomationsTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.engine = create_engine(f"sqlite:///{Path(self.directory.name) / 'test.db'}")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine, expire_on_commit=False)
        workspace = Workspace(name="Pusula", description="Test")
        self.db.add(workspace)
        self.db.flush()
        self.alice = User(workspace_id=workspace.workspace_id, role="Member", display_name="Deniz", email="deniz@test.invalid", password_hash="unused")
        self.bob = User(workspace_id=workspace.workspace_id, role="Member", display_name="Ece", email="ece@test.invalid", password_hash="unused")
        self.db.add_all([self.alice, self.bob])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        self.directory.cleanup()

    def create(self):
        return create_automation(AutomationCreate(title="Günlük özet", prompt="Açık işleri Türkçe özetle.", schedule_time="16:00", starts_at=datetime(2026, 10, 9, 13, 0, tzinfo=UTC)), self.alice, self.db)

    def test_validation(self):
        for time in ("24:00", "8:00", "16:60", "16:00x"):
            with self.assertRaises(ValidationError):
                AutomationCreate(title="Test", prompt="Özet", schedule_time=time)
        with self.assertRaises(ValidationError):
            AutomationCreate(title=" ", prompt="Özet", schedule_time="16:00")
        with self.assertRaises(ValidationError):
            AutomationCreate(title="Test", prompt="Özet", schedule_time="16:00", response_language="de")
        with self.assertRaises(ValidationError):
            AutomationCreate(title="Test", prompt="Özet", schedule_time="16:00", frequency="monthly")
        with self.assertRaises(ValidationError):
            AutomationCreate(title="Test", prompt="Özet", schedule_time="16:00", starts_at=datetime(2026, 10, 9, 16, 0))

    def test_selected_language_is_persisted_and_passed_to_manual_run(self):
        item = create_automation(
            AutomationCreate(title="Daily recap", prompt="Summarise open work.", schedule_time="16:00", response_language="en"),
            self.alice,
            self.db,
        )
        self.assertEqual("en", item.response_language)
        accepted = run_automation(item.automation_id, self.alice, self.db)
        run = self.db.get(ColleagueRun, accepted.run_id)
        assert run is not None
        self.assertEqual("en", run.response_language)

    def test_owner_boundary_and_crud(self):
        item = self.create()
        self.assertEqual(len(list_automations(self.alice, self.db).items), 1)
        self.assertEqual(list_automations(self.bob, self.db).items, [])
        for operation in (
            lambda: update_automation(item.automation_id, AutomationUpdate(enabled=False), self.bob, self.db),
            lambda: delete_automation(item.automation_id, self.bob, self.db),
            lambda: run_automation(item.automation_id, self.bob, self.db),
        ):
            with self.assertRaises(HTTPException) as error:
                operation()
            self.assertEqual(error.exception.status_code, 404)
        update_automation(item.automation_id, AutomationUpdate(enabled=False), self.alice, self.db)
        self.assertIsNone(list_automations(self.alice, self.db).items[0].next_run_at)
        delete_automation(item.automation_id, self.alice, self.db)
        self.assertEqual(list_automations(self.alice, self.db).items, [])

    def test_schedule_istanbul_once_per_day_and_disabled(self):
        item = self.create()
        before = datetime(2026, 10, 9, 12, 59, tzinfo=UTC)
        due = before + timedelta(minutes=1)
        self.assertEqual(dispatch_due_automations(self.db, before), 0)
        self.assertEqual(dispatch_due_automations(self.db, due), 1)
        self.assertEqual(dispatch_due_automations(self.db, due + timedelta(hours=2)), 0)
        self.assertEqual(len(self.db.scalars(select(ColleagueRun)).all()), 1)
        automation = self.db.get(Automation, item.automation_id)
        assert automation is not None
        self.assertEqual(next_run_at(automation, due), due + timedelta(days=1))
        self.assertEqual(dispatch_due_automations(self.db, due + timedelta(days=1)), 1)
        automation.enabled = False
        self.db.commit()
        self.assertEqual(dispatch_due_automations(self.db, due + timedelta(days=2)), 0)

    def test_manual_run_does_not_consume_daily_schedule(self):
        item = self.create()
        accepted = run_automation(item.automation_id, self.alice, self.db)
        run = self.db.get(ColleagueRun, accepted.run_id)
        assert run is not None
        self.assertEqual(run.thread_id, f"automation:{item.automation_id}")
        self.assertIn(self.alice.user_id, run.participant_user_ids)
        self.assertNotIn(self.bob.user_id, run.participant_user_ids)
        automation = self.db.get(Automation, item.automation_id)
        assert automation is not None
        self.assertIsNotNone(automation.last_run_at)
        self.assertEqual(accepted.run_id, automation.last_run_id)
        self.assertIsNone(automation.last_scheduled_at)
        queued = list_automations(self.alice, self.db).items[0]
        self.assertEqual(queued.last_run_id, accepted.run_id)
        self.assertEqual(queued.last_run_status, "queued")
        self.assertIsNone(queued.last_run_at)
        due = datetime(2026, 10, 10, 13, 0, tzinfo=UTC)
        self.assertEqual(dispatch_due_automations(self.db, due), 1)
        self.assertEqual(len(self.db.scalars(select(ColleagueRun)).all()), 2)

    def test_last_run_resolution_excludes_another_users_spoofed_thread(self):
        item = self.create()
        automation = self.db.get(Automation, item.automation_id)
        assert automation is not None
        legacy_time = datetime(2026, 10, 9, 12, 55)
        spoof = ColleagueRun(
            workspace_id=self.alice.workspace_id, created_by=self.bob.user_id, kind="ask",
            client_request_id="spoof-automation-run", idempotency_key="spoof-automation-run",
            thread_id=f"automation:{item.automation_id}", thread_title=item.title,
            thread_kind="direct", participant_user_ids=[self.bob.user_id], question="Spoof",
            status="completed", answer="Başkasının çıktısı", started_at=datetime(2026, 10, 9, 13, 5),
            created_at=datetime(2026, 10, 9, 13, 0),
        )
        self.db.add(spoof)
        self.db.flush()
        automation.last_run_id = spoof.run_id
        automation.last_run_at = legacy_time
        self.db.commit()
        resolved = list_automations(self.alice, self.db).items[0]
        self.assertIsNone(resolved.last_run_id)
        self.assertIsNone(resolved.last_run_status)
        self.assertEqual(resolved.last_run_at, legacy_time)

    def test_stored_automation_run_wins_over_a_later_owner_follow_up(self):
        item = self.create()
        accepted = run_automation(item.automation_id, self.alice, self.db)
        follow_up = ColleagueRun(
            workspace_id=self.alice.workspace_id, created_by=self.alice.user_id, kind="ask",
            client_request_id="later-follow-up", idempotency_key="later-follow-up",
            thread_id=f"automation:{item.automation_id}", thread_title=item.title,
            thread_kind="direct", participant_user_ids=[self.alice.user_id], question="Detaylandır",
            status="completed", answer="Takip yanıtı", started_at=datetime(2026, 10, 9, 13, 5),
            created_at=datetime(2026, 10, 9, 13, 0),
        )
        self.db.add(follow_up)
        self.db.commit()
        resolved = list_automations(self.alice, self.db).items[0]
        self.assertEqual(resolved.last_run_id, accepted.run_id)
        self.assertEqual(resolved.last_run_status, "queued")
        self.assertIsNone(resolved.last_run_at)

    def test_hourly_schedule_dispatches_latest_slot_once_without_catchup(self):
        item = create_automation(AutomationCreate(
            title="Saatlik kontrol", prompt="Kontrol et.", schedule_time="09:00", frequency="hourly",
            starts_at=datetime(2026, 10, 1, 9, 0, tzinfo=UTC),
        ), self.alice, self.db)
        now = datetime(2026, 10, 9, 12, 35, tzinfo=UTC)
        self.assertEqual(dispatch_due_automations(self.db, now), 1)
        self.assertEqual(dispatch_due_automations(self.db, now + timedelta(minutes=10)), 0)
        automation = self.db.get(Automation, item.automation_id)
        assert automation is not None
        self.assertEqual(automation.last_scheduled_at, datetime(2026, 10, 9, 12, 0))
        self.assertEqual(next_run_at(automation, now), datetime(2026, 10, 9, 13, 0, tzinfo=UTC))
        self.assertEqual(len(self.db.scalars(select(ColleagueRun)).all()), 1)

    def test_frequency_and_start_changes_reset_only_the_schedule_checkpoint(self):
        item = self.create()
        due = datetime(2026, 10, 9, 13, 0, tzinfo=UTC)
        self.assertEqual(dispatch_due_automations(self.db, due), 1)
        updated = update_automation(item.automation_id, AutomationUpdate(
            frequency="weekly", starts_at=datetime(2030, 10, 10, 10, 0, tzinfo=UTC)
        ), self.alice, self.db)
        self.assertEqual(updated.frequency, "weekly")
        self.assertEqual(updated.starts_at, datetime(2030, 10, 10, 10, 0))
        self.assertEqual(updated.schedule_time, "13:00")
        self.assertEqual(updated.next_run_at, datetime(2030, 10, 10, 10, 0, tzinfo=UTC))
        automation = self.db.get(Automation, item.automation_id)
        assert automation is not None
        self.assertIsNone(automation.last_scheduled_at)
        self.assertIsNotNone(automation.last_run_at)

    def test_overdue_next_run_is_now_and_naive_dates_are_utc(self):
        item = self.create()
        now = datetime(2026, 10, 9, 14, 0, tzinfo=UTC)
        automation = self.db.get(Automation, item.automation_id)
        assert automation is not None
        self.assertEqual(next_run_at(automation, now.replace(tzinfo=None)), now)

    def test_recovery_after_enqueue_does_not_duplicate_or_crash_after_edit(self):
        item = self.create()
        due = datetime(2026, 10, 9, 13, 0, tzinfo=UTC)
        self.assertEqual(dispatch_due_automations(self.db, due), 1)
        automation = self.db.get(Automation, item.automation_id)
        assert automation is not None
        automation.last_run_at = None
        automation.last_scheduled_at = None  # Simulate a crash before the schedule checkpoint.
        automation.prompt = "Yeni günlük özet isteği."
        automation.response_language = "en"
        self.db.commit()
        self.assertEqual(dispatch_due_automations(self.db, due), 1)
        runs = self.db.scalars(select(ColleagueRun)).all()
        self.assertEqual(len(runs), 1)
        self.assertEqual("tr", runs[0].response_language)

    def test_next_run_stays_on_the_anchor_grid_after_a_late_dispatch(self):
        item = self.create()
        automation = self.db.get(Automation, item.automation_id)
        assert automation is not None
        automation.last_scheduled_at = datetime(2026, 10, 9, 13, 2)
        self.db.commit()
        self.assertEqual(
            next_run_at(automation, datetime(2026, 10, 9, 13, 3, tzinfo=UTC)),
            datetime(2026, 10, 10, 13, 0, tzinfo=UTC),
        )

    def test_legacy_schema_adds_language_columns_without_changing_existing_rows(self):
        item = self.create()
        accepted = run_automation(item.automation_id, self.alice, self.db)
        self.db.close()
        with self.engine.begin() as connection:
            connection.exec_driver_sql("ALTER TABLE automations DROP COLUMN response_language")
            connection.exec_driver_sql("ALTER TABLE automations DROP COLUMN frequency")
            connection.exec_driver_sql("ALTER TABLE automations DROP COLUMN starts_at")
            connection.exec_driver_sql("ALTER TABLE automations DROP COLUMN last_run_id")
            connection.exec_driver_sql("ALTER TABLE automations DROP COLUMN last_scheduled_at")
            connection.exec_driver_sql("ALTER TABLE colleague_runs DROP COLUMN response_language")
        ensure_legacy_schema_compatibility(self.engine)
        with self.engine.connect() as connection:
            self.assertEqual("tr", connection.exec_driver_sql(
                "SELECT response_language FROM automations WHERE automation_id = ?", (item.automation_id,)
            ).scalar_one())
            self.assertEqual("daily", connection.exec_driver_sql(
                "SELECT frequency FROM automations WHERE automation_id = ?", (item.automation_id,)
            ).scalar_one())
            self.assertEqual("tr", connection.exec_driver_sql(
                "SELECT response_language FROM colleague_runs WHERE run_id = ?", (accepted.run_id,)
            ).scalar_one())
        self.db = Session(self.engine, expire_on_commit=False)


if __name__ == "__main__":
    unittest.main()
