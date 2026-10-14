from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi import HTTPException, Response
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session
from starlette.requests import Request

from app.config import Settings
from app.db import Base
from app.dependencies import get_current_user
from app.models import CompanyChatMessage, PublicDemoQuota, User, UserSession, Workspace
from app.routers.auth import public_demo_config, public_demo_sign_in
from app.routers.team_chat import list_team_chat_messages
from app.routers.work import list_conversations
from app.schemas.api import PublicDemoSignInRequest
from app.services.security import consume_public_demo_quota, public_demo_ip_hash, resolve_client_ip


def request_for(ip: str, *, path: str = "/api/auth/demo/sign-in", method: str = "POST", headers: dict[str, str] | None = None) -> Request:
    return Request({
        "type": "http",
        "method": method,
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "headers": [(key.lower().encode(), value.encode()) for key, value in (headers or {}).items()],
        "client": (ip, 41000),
        "server": ("testserver", 443),
        "scheme": "https",
    })


class PublicDemoTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(prefix="izge-public-demo-")
        self.engine = create_engine(
            f"sqlite:///{Path(self.temp_dir.name) / 'test.db'}",
            connect_args={"check_same_thread": False, "timeout": 10},
        )
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine, expire_on_commit=False)
        self.workspace = Workspace(name="Pusula Yazılım ve IT Danışmanlık", description="Demo")
        self.db.add(self.workspace)
        self.db.flush()
        for name, email, role in (
            ("Kerem Demir", "kerem@pusula.demo", "Member"),
            ("Selin Aras", "selin@pusula.demo", "Admin"),
        ):
            self.db.add(User(
                workspace_id=self.workspace.workspace_id,
                role=role,
                display_name=name,
                email=email,
                password_hash="unused",
            ))
        self.db.commit()
        self.settings = Settings(public_demo_enabled=True, public_demo_hourly_limit=10)

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()
        self.temp_dir.cleanup()

    def sign_in(self, persona: str, ip: str, visitor: str = "a" * 32):
        with (
            patch("app.routers.auth.get_settings", return_value=self.settings),
            patch("app.services.security.get_settings", return_value=self.settings),
            patch("app.services.security.engine", self.engine),
        ):
            return public_demo_sign_in(
                PublicDemoSignInRequest(persona=persona),
                request_for(ip, headers={"cookie": f"izge_demo_visitor={visitor}"}),
                Response(),
                self.db,
            )

    def test_config_is_private_by_default_and_lists_only_public_personas(self) -> None:
        with patch("app.routers.auth.get_settings", return_value=Settings()):
            config = public_demo_config()
        self.assertFalse(config.enabled)
        self.assertEqual(10, config.hourly_limit)
        self.assertEqual(
            [("kerem", "Kerem Demir", "Software Engineer"), ("selin", "Selin Aras", "Team Lead")],
            [(persona.id, persona.name, persona.title) for persona in config.personas],
        )

    def test_sign_in_creates_stable_member_per_visitor_and_persona_without_session_growth(self) -> None:
        first = self.sign_in("selin", "203.0.113.10")
        second = self.sign_in("selin", "203.0.113.10")
        other_persona = self.sign_in("kerem", "203.0.113.10")
        other_visitor = self.sign_in("selin", "203.0.113.10", "b" * 32)

        self.assertEqual(first.user.user_id, second.user.user_id)
        self.assertEqual("Member", first.user.role)
        self.assertTrue(first.user.is_public_demo)
        self.assertEqual("selin", first.user.public_demo_persona)
        self.assertNotEqual(first.user.user_id, other_persona.user.user_id)
        self.assertNotEqual(first.user.user_id, other_visitor.user.user_id)
        self.assertEqual(3, self.db.scalar(select(func.count()).select_from(User).where(User.is_public_demo.is_(True))))
        self.assertEqual(1, self.db.scalar(select(func.count()).select_from(UserSession).where(UserSession.user_id == first.user.user_id)))

    def test_demo_session_is_ip_bound_and_cannot_mutate_alternate_routes(self) -> None:
        signed_in = self.sign_in("kerem", "203.0.113.20")
        with patch("app.dependencies.get_settings", return_value=self.settings):
            with self.assertRaises(HTTPException) as wrong_ip:
                get_current_user(request_for("203.0.113.21", path="/api/work/conversations", method="GET"), signed_in.access_token, self.db)
            self.assertEqual(401, wrong_ip.exception.status_code)
            with self.assertRaises(HTTPException) as blocked:
                get_current_user(request_for("203.0.113.20", path="/api/query", method="POST"), signed_in.access_token, self.db)
            self.assertEqual(403, blocked.exception.status_code)
            with self.assertRaises(HTTPException) as old_ask:
                get_current_user(request_for("203.0.113.20", path="/api/work/ask", method="POST"), signed_in.access_token, self.db)
            self.assertEqual(403, old_ask.exception.status_code)
            for path in ("/api/demo/ask", "/api/demo/ask/events", "/api/demo/extract"):
                allowed = get_current_user(request_for("203.0.113.20", path=path, method="POST"), signed_in.access_token, self.db)
                self.assertEqual(signed_in.user.user_id, allowed.user_id)
            with self.assertRaises(HTTPException) as nested_route:
                get_current_user(request_for("203.0.113.20", path="/api/demo/ask/events/delete", method="POST"), signed_in.access_token, self.db)
            self.assertEqual(403, nested_route.exception.status_code)

    def test_visitors_share_only_persona_baseline_access_not_private_history(self) -> None:
        kerem_token = self.sign_in("kerem", "203.0.113.40", "k" * 32)
        other_kerem_token = self.sign_in("kerem", "203.0.113.40", "o" * 32)
        selin_token = self.sign_in("selin", "203.0.113.40", "s" * 32)
        kerem = self.db.get(User, kerem_token.user.user_id)
        other_kerem = self.db.get(User, other_kerem_token.user.user_id)
        selin = self.db.get(User, selin_token.user.user_id)
        source_kerem = self.db.scalar(select(User).where(User.email == "kerem@pusula.demo"))
        self.assertIsNotNone(kerem)
        self.assertIsNotNone(other_kerem)
        self.assertIsNotNone(selin)
        self.assertIsNotNone(source_kerem)
        self.db.add(CompanyChatMessage(
            workspace_id=self.workspace.workspace_id,
            author_user_id=source_kerem.user_id,
            body="Kerem persona baseline",
            message_metadata={
                "thread_id": "kerem-only",
                "thread_kind": "group",
                "participant_user_ids": [source_kerem.user_id],
                "seeded": True,
                "seed_batch": "pusula-b2b-demo-v1",
            },
        ))
        self.db.commit()

        self.assertEqual(["Kerem persona baseline"], [item.body for item in list_team_chat_messages(80, kerem, self.db).messages])
        self.assertEqual(["Kerem persona baseline"], [item.body for item in list_team_chat_messages(80, other_kerem, self.db).messages])
        self.assertEqual([], list_team_chat_messages(80, selin, self.db).messages)
        kerem_conversation = list_conversations(False, kerem, self.db).items[0]
        other_kerem_conversation = list_conversations(False, other_kerem, self.db).items[0]
        self.assertNotEqual(kerem_conversation.conversation_id, other_kerem_conversation.conversation_id)

    def test_forwarded_ip_is_only_used_in_explicit_railway_mode(self) -> None:
        spoofed = request_for("127.0.0.1", headers={"x-real-ip": "203.0.113.99"})
        with patch("app.services.security.get_settings", return_value=Settings(trust_railway_proxy=False)):
            self.assertEqual("127.0.0.1", resolve_client_ip(spoofed))
        with patch("app.services.security.get_settings", return_value=Settings(trust_railway_proxy=True)):
            self.assertEqual("203.0.113.99", resolve_client_ip(spoofed))
            self.assertIsNone(resolve_client_ip(request_for("127.0.0.1")))
            self.assertIsNone(resolve_client_ip(request_for("127.0.0.1", headers={"x-real-ip": "bad, 203.0.113.99"})))

    def test_hourly_quota_is_atomic_across_concurrent_requests_and_returns_retry_after(self) -> None:
        ip_hash = public_demo_ip_hash("203.0.113.30")
        now = datetime(2026, 10, 12, 20, 35, 27)

        def consume() -> tuple[int, str | None]:
            try:
                return consume_public_demo_quota(ip_hash=ip_hash, now=now), None
            except HTTPException as exc:
                return exc.status_code, exc.headers.get("Retry-After") if exc.headers else None

        with (
            patch("app.services.security.engine", self.engine),
            patch("app.services.security.get_settings", return_value=self.settings),
            ThreadPoolExecutor(max_workers=20) as pool,
        ):
            results = list(pool.map(lambda _: consume(), range(20)))

        self.assertEqual(10, sum(1 for value, _header in results if value <= 10))
        self.assertEqual(10, sum(1 for value, _header in results if value == 429))
        self.assertTrue(all(header == "1473" for value, header in results if value == 429))
        with Session(self.engine) as session:
            quota = session.scalar(select(PublicDemoQuota).where(PublicDemoQuota.ip_hash == ip_hash))
            self.assertIsNotNone(quota)
            self.assertEqual(10, quota.request_count)


if __name__ == "__main__":
    unittest.main()
