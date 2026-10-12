from __future__ import annotations

import hashlib
import hmac
import ipaddress
import secrets
import threading
import time
from datetime import datetime, timedelta

from fastapi import HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import engine
from app.models import PublicDemoQuota, User, UserSession
from app.models.domain import new_id


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 390000)
    return f"{salt}${digest.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    salt, expected = password_hash.split("$", maxsplit=1)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 390000)
    return hmac.compare_digest(digest.hex(), expected)


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def resolve_client_ip(request: Request) -> str | None:
    raw_peer = request.scope.get("client")
    peer = str(raw_peer[0]).strip() if isinstance(raw_peer, (tuple, list)) and raw_peer else ""
    candidate = peer
    if get_settings().trust_railway_proxy and peer in {"127.0.0.1", "::1"}:
        forwarded = request.headers.get("x-real-ip", "").strip()
        if not forwarded or "," in forwarded:
            return None
        candidate = forwarded
    try:
        address = ipaddress.ip_address(candidate)
    except ValueError:
        return None
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        address = address.ipv4_mapped
    return address.compressed


def public_demo_ip_hash(client_ip: str) -> str:
    return hashlib.sha256(f"izge-public-demo:{client_ip}".encode("utf-8")).hexdigest()


def public_demo_source_user_id(db: Session, user: User) -> str | None:
    if not user.is_public_demo or user.public_demo_persona not in {"kerem", "selin"}:
        return None
    return db.scalar(select(User.user_id).where(
        User.workspace_id == user.workspace_id,
        User.email == f"{user.public_demo_persona}@pusula.demo",
        User.is_public_demo.is_(False),
    ))


def consume_public_demo_quota(*, ip_hash: str, now: datetime | None = None, limit: int | None = None) -> int:
    settings = get_settings()
    effective_limit = max(limit if limit is not None else settings.public_demo_hourly_limit, 1)
    current = now or datetime.utcnow()
    window = current.replace(minute=0, second=0, microsecond=0)
    statement = (
        sqlite_insert(PublicDemoQuota)
        .values(quota_id=new_id("pdq"), ip_hash=ip_hash, window_started_at=window, request_count=1)
        .on_conflict_do_update(
            index_elements=[PublicDemoQuota.ip_hash, PublicDemoQuota.window_started_at],
            set_={"request_count": PublicDemoQuota.request_count + 1},
            where=PublicDemoQuota.request_count < effective_limit,
        )
        .returning(PublicDemoQuota.request_count)
    )
    with engine.begin() as connection:
        connection.execute(delete(PublicDemoQuota).where(PublicDemoQuota.window_started_at < window - timedelta(hours=48)))
        count = connection.execute(statement).scalar_one_or_none()
    if count is None:
        retry_after = max(1, 3600 - current.minute * 60 - current.second)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Saatlik demo kullanım sınırına ulaştınız ({effective_limit} istek).",
            headers={"Retry-After": str(retry_after)},
        )
    return int(count)


def _rate_limit_key(client_host: str | None, email: str) -> str:
    normalized_host = (client_host or "unknown").strip().lower()
    normalized_email = email.strip().lower()
    return f"{normalized_host}:{normalized_email}"


_SIGN_IN_FAILURES: dict[str, list[float]] = {}
_SIGN_IN_LOCK = threading.Lock()


def enforce_sign_in_rate_limit(*, client_host: str | None, email: str) -> None:
    settings = get_settings()
    key = _rate_limit_key(client_host, email)
    now = time.monotonic()
    window_start = now - max(settings.auth_rate_limit_window_seconds, 1)
    with _SIGN_IN_LOCK:
        attempts = [timestamp for timestamp in _SIGN_IN_FAILURES.get(key, []) if timestamp >= window_start]
        _SIGN_IN_FAILURES[key] = attempts
        if len(attempts) >= max(settings.auth_rate_limit_max_attempts, 1):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Çok fazla başarısız giriş denemesi. Lütfen daha sonra tekrar deneyin.",
            )


def record_sign_in_failure(*, client_host: str | None, email: str) -> None:
    settings = get_settings()
    key = _rate_limit_key(client_host, email)
    now = time.monotonic()
    window_start = now - max(settings.auth_rate_limit_window_seconds, 1)
    with _SIGN_IN_LOCK:
        attempts = [timestamp for timestamp in _SIGN_IN_FAILURES.get(key, []) if timestamp >= window_start]
        attempts.append(now)
        _SIGN_IN_FAILURES[key] = attempts


def record_sign_in_success(*, client_host: str | None, email: str) -> None:
    key = _rate_limit_key(client_host, email)
    with _SIGN_IN_LOCK:
        _SIGN_IN_FAILURES.pop(key, None)


def create_session(db: Session, user: User) -> tuple[UserSession, str]:
    settings = get_settings()
    raw_token = secrets.token_urlsafe(32)
    if user.is_public_demo:
        db.execute(delete(UserSession).where(UserSession.user_id == user.user_id))
    session = UserSession(
        workspace_id=user.workspace_id,
        user_id=user.user_id,
        token=hash_session_token(raw_token),
        expires_at=datetime.utcnow() + timedelta(hours=settings.token_ttl_hours),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session, raw_token


def authenticate_user(db: Session, email: str, password: str) -> User:
    user = db.scalar(select(User).where(User.email == email))
    if user is None or not user.is_active or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="E-posta veya şifre hatalı.")
    return user


def get_user_by_token(db: Session, token: str) -> User:
    session = db.scalar(select(UserSession).where(UserSession.token == hash_session_token(token)))
    if session is None or session.expires_at < datetime.utcnow():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Oturumunuzun süresi doldu. Lütfen yeniden giriş yapın.")
    user = db.scalar(select(User).where(User.user_id == session.user_id))
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bu kullanıcı hesabı etkin değil.")
    return user


def revoke_session_token(db: Session, token: str) -> None:
    db.execute(delete(UserSession).where(UserSession.token == hash_session_token(token)))
    db.commit()
