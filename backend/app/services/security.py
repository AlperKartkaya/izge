from __future__ import annotations

import hashlib
import hmac
import secrets
import threading
import time
from datetime import datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import User, UserSession


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
                detail="Too many failed sign-in attempts. Try again later.",
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
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return user


def get_user_by_token(db: Session, token: str) -> User:
    session = db.scalar(select(UserSession).where(UserSession.token == hash_session_token(token)))
    if session is None or session.expires_at < datetime.utcnow():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    user = db.scalar(select(User).where(User.user_id == session.user_id))
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Inactive user")
    return user


def revoke_session_token(db: Session, token: str) -> None:
    db.execute(delete(UserSession).where(UserSession.token == hash_session_token(token)))
    db.commit()
