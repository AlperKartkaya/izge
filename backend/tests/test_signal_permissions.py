import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base
from app.models import Artifact, Signal, User, Workspace
from app.services.permissions import signal_is_visible_to_artifact_ids
from app.services.querying import get_persisted_signal_detail, list_persisted_signals


class DerivedSignalPermissionsTest(unittest.TestCase):
    def test_public_source_does_not_publish_private_supporting_evidence(self):
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine)
        with Session(engine, expire_on_commit=False) as db:
            workspace = Workspace(name="Şirket", description="")
            db.add(workspace)
            db.flush()
            alice = User(workspace_id=workspace.workspace_id, email="alice@example.com", display_name="Alice", role="Member", password_hash="unused", is_active=True)
            bob = User(workspace_id=workspace.workspace_id, email="bob@example.com", display_name="Bob", role="Member", password_hash="unused", is_active=True)
            db.add_all([alice, bob])
            db.flush()
            public = Artifact(workspace_id=workspace.workspace_id, title="Ortak kaynak", source_type="pasted_text", source_path="unused", mime_type="text/plain", uploaded_by=alice.user_id, visibility_scope="workspace", review_status="approved", ingestion_status="completed")
            private = Artifact(workspace_id=workspace.workspace_id, title="Gizli ücret kararı", source_type="pasted_text", source_path="unused", mime_type="text/plain", uploaded_by=alice.user_id, visibility_scope="restricted", review_status="approved", ingestion_status="completed")
            db.add_all([public, private])
            db.flush()
            signal = Signal(workspace_id=workspace.workspace_id, source_artifact_id=public.artifact_id, signal_type="continuity_overlap", title="Gizli ücret kararıyla ilişkili", summary="Gizli kayıt özeti", related_topic="ücret", urgency_score=0.5, uncertainty_score=0.1, grounded_reasoning="Kaynaklı", payload_json={"supporting_evidence": [{"artifact_id": private.artifact_id}]}, status="active")
            db.add(signal)
            db.commit()
            self.assertEqual([], list_persisted_signals(db, bob))
            self.assertIsNone(get_persisted_signal_detail(db, bob, signal.signal_id))
            self.assertEqual([signal.signal_id], [item.signal_id for item in list_persisted_signals(db, alice)])
            self.assertFalse(signal_is_visible_to_artifact_ids(signal, {public.artifact_id}))
            signal.payload_json = {"llm_signal_explanation": {"cited_artifact_ids": [public.artifact_id, private.artifact_id]}}
            self.assertFalse(signal_is_visible_to_artifact_ids(signal, {public.artifact_id}))
        engine.dispose()
