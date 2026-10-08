from datetime import datetime
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine, event, func, select, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.config import Settings, get_settings
from app.db import Base
from app.models import Artifact, ArtifactChunk, ClaimOccurrence, GraphNode, IngestionJob, QueryRun, User, Workspace
from app.routers.artifacts import _feed_memory_inline
from app.services.bootstrap import seed_defaults
from app.services.ingestion import (
    PersistedMemory,
    _extract_due_date_hint,
    _extract_owner_hint,
    _infer_memory_type,
    _is_contradiction_relationship,
    _is_supersede_relationship,
    _topic_tokens,
    run_ingestion,
)
from app.services.turkish_text import status_label
from app.services.querying import _classify_query_with_keywords, _query_terms, _text_overlap


class TurkishLanguageTests(unittest.TestCase):
    def test_user_facing_status_labels_are_turkish(self) -> None:
        self.assertEqual(status_label("stale"), "yeniden incelenmeli")
        self.assertEqual(status_label("reversed"), "tersine döndü")

    def test_turkish_query_modes_keep_api_enum_contract(self) -> None:
        cases = {
            "Bu karar neden alındı, geçmişi nedir?": "Decision lineage",
            "Yeni plan eski kararla çelişiyor mu?": "Contradiction analysis",
            "Hangi varsayımlar artık geçerli değil?": "Assumption drift",
            "Bundan sonra ne yapmalıyız?": "Next-action guidance",
        }
        for query, expected in cases.items():
            with self.subTest(query=query):
                self.assertEqual(_classify_query_with_keywords(query).query_class, expected)

    def test_turkish_unicode_tokens_are_preserved_and_normalized(self) -> None:
        self.assertTrue({"iş", "yükü", "ığdır", "çözümü", "çözüm"}.issubset(_query_terms("İş yükü IĞDIR çözümü")))
        self.assertIn("güvenlik", _topic_tokens("Güvenlik incelemesi tamamlanmalı"))
        self.assertGreater(_text_overlap("müşteri kararı", "müşteri kararını açıkla"), 0)

    def test_turkish_memory_extraction_hints(self) -> None:
        self.assertEqual(_infer_memory_type("Karar: kontrollü beta ile devam edeceğiz.", "Kararlar")[0], "decision")
        self.assertEqual(_infer_memory_type("Varsayım: destek yükü düşük kalacak.", "Varsayımlar")[0], "assumption")
        self.assertEqual(_infer_memory_type("Güvenlik onayı olmadan yayın yapılamaz.", "Kısıtlar")[0], "constraint")
        self.assertEqual(_infer_memory_type("Sonuç: hata oranı yüzde 20 arttı.", "Sonuçlar")[0], "outcome")
        self.assertEqual(_infer_memory_type("Deniz 12.10.2026 tarihine kadar raporu hazırlayacak.", "Taahhütler")[0], "commitment")
        self.assertEqual(_extract_owner_hint("Deniz raporu yarın hazırlayacak"), "Deniz")
        self.assertEqual(_extract_due_date_hint("12.10.2026 tarihine kadar tamamlanacak"), datetime(2026, 10, 12))

    def test_turkish_decision_change_is_linked(self) -> None:
        common = {
            "memory_type": "decision",
            "node_id": "node",
            "source_artifact_id": "artifact",
            "source_chunk_id": "chunk",
            "confidence_score": 0.9,
            "topic_key": "müşteri portalı yayın",
        }
        earlier = PersistedMemory(
            **common,
            memory_id="old",
            title_or_label="Müşteri portalı yayını Q3'e ertelendi",
            normalized_text="Müşteri portalı yayını Q3'e ertelendi.",
            event_timestamp=datetime(2026, 9, 1),
        )
        later = PersistedMemory(
            **common,
            memory_id="new",
            title_or_label="Müşteri portalı yayını Q2'de yeniden yapılacak",
            normalized_text="Müşteri portalı Q2'de yeniden yayınlanacak.",
            event_timestamp=datetime(2026, 10, 1),
        )
        self.assertTrue(_is_supersede_relationship(earlier, later))
        self.assertTrue(_is_contradiction_relationship(earlier, later))

    def test_demo_seed_is_opt_in_and_default_model_is_qwen_9b(self) -> None:
        settings = Settings(_env_file=None)
        self.assertFalse(settings.demo_seed_enabled)
        self.assertEqual(settings.local_llm_model, "qwen3.5:9b")
        self.assertIsNone(settings.default_admin_password)

    def test_inline_ingestion_does_not_mutate_cached_settings(self) -> None:
        settings = get_settings()
        before = (
            settings.local_llm_enabled,
            settings.llm_signal_explanation_enabled,
        )
        db = SimpleNamespace(commit=lambda: None)
        artifact = SimpleNamespace(ingestion_status="pending", review_status="submitted", review_notes=None)
        actor = SimpleNamespace()
        with patch("app.services.ingestion.run_ingestion") as run_ingestion:
            _feed_memory_inline(db, artifact, actor)
        run_ingestion.assert_called_once_with(
            db,
            artifact=artifact,
            actor=actor,
            use_local_llm=settings.local_llm_enabled,
            use_signal_explanations=False,
        )
        self.assertEqual(
            (settings.local_llm_enabled, settings.llm_signal_explanation_enabled),
            before,
        )

    def test_reingestion_replaces_derived_graph_without_deleting_query_history(self) -> None:
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )

        @event.listens_for(engine, "connect")
        def enable_foreign_keys(connection, _record) -> None:  # type: ignore[no-untyped-def]
            connection.execute("PRAGMA foreign_keys=ON")

        Base.metadata.create_all(engine)
        with engine.begin() as connection:
            connection.execute(
                text(
                    "CREATE VIRTUAL TABLE artifact_chunks_fts USING fts5("
                    "chunk_id UNINDEXED, artifact_id UNINDEXED, workspace_id UNINDEXED, text)"
                )
            )

        with Session(engine, expire_on_commit=False) as db:
            workspace = Workspace(name="Test", description="Test")
            db.add(workspace)
            db.flush()
            actor = User(
                workspace_id=workspace.workspace_id,
                role="Admin",
                display_name="Yönetici",
                email="admin@test.local",
                password_hash="test",
            )
            db.add(actor)
            db.flush()
            artifact = Artifact(
                workspace_id=workspace.workspace_id,
                title="Türkçe karar notu 2026-10-08",
                source_type="pasted_text",
                source_path="unused",
                mime_type="text/plain",
                uploaded_by=actor.user_id,
                visibility_scope="workspace",
                ingestion_status="pending",
                review_status="reviewed",
            )
            db.add(artifact)
            db.commit()
            source = """# Kararlar\nKarar: Müşteri portalı kontrollü beta ile yayınlanacak.\n# Varsayımlar\nVarsayım: Destek yükü düşük kalacak.\n# Taahhütler\nDeniz 12.10.2026 tarihine kadar hazırlık raporunu tamamlayacak."""
            with patch("app.services.ingestion.extract_text_for_artifact", return_value=source):
                first = run_ingestion(db, artifact=artifact, actor=actor, use_local_llm=False)
                query = QueryRun(
                    workspace_id=workspace.workspace_id,
                    created_by=actor.user_id,
                    query_text="Portal kararı neden alındı?",
                    query_class="Decision lineage",
                    answer_text="Kayıtlı yanıt",
                    answer_payload={},
                )
                db.add(query)
                db.commit()
                second = run_ingestion(db, artifact=artifact, actor=actor, use_local_llm=False)

            self.assertEqual(first.status, "completed")
            self.assertEqual(second.status, "completed")
            self.assertEqual(db.scalar(select(func.count()).select_from(ArtifactChunk)), 1)
            self.assertGreater(db.scalar(select(func.count()).select_from(GraphNode)) or 0, 0)
            self.assertGreater(db.scalar(select(func.count()).select_from(ClaimOccurrence)) or 0, 0)
            self.assertEqual(db.scalar(select(func.count()).select_from(QueryRun)), 1)
            self.assertEqual(db.scalar(select(func.count()).select_from(IngestionJob)), 2)
        engine.dispose()

    def test_production_bootstrap_preserves_existing_admin_and_skips_demo_data(self) -> None:
        engine = create_engine("sqlite://", poolclass=StaticPool)
        Base.metadata.create_all(engine)
        with Session(engine, expire_on_commit=False) as db:
            workspace = Workspace(name="Mevcut Şirket", description="Korunmalı")
            db.add(workspace)
            db.flush()
            admin = User(
                workspace_id=workspace.workspace_id,
                role="Member",
                display_name="Mevcut Kullanıcı",
                email="admin@example.com",
                password_hash="korunacak-hash",
                is_active=False,
            )
            db.add(admin)
            db.commit()
            settings = Settings(_env_file=None, demo_seed_enabled=False)
            with patch("app.services.bootstrap.get_settings", return_value=settings):
                seed_defaults(db)
            db.refresh(admin)
            self.assertEqual(admin.role, "Member")
            self.assertEqual(admin.display_name, "Mevcut Kullanıcı")
            self.assertEqual(admin.password_hash, "korunacak-hash")
            self.assertFalse(admin.is_active)
            self.assertEqual(db.scalar(select(func.count()).select_from(User)), 1)
            self.assertEqual(db.scalar(select(func.count()).select_from(Artifact)), 0)
        engine.dispose()


if __name__ == "__main__":
    unittest.main()
