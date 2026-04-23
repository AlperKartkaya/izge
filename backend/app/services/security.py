from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import select
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


def create_session(db: Session, user: User) -> UserSession:
    settings = get_settings()
    session = UserSession(
        workspace_id=user.workspace_id,
        user_id=user.user_id,
        token=secrets.token_urlsafe(32),
        expires_at=datetime.utcnow() + timedelta(hours=settings.token_ttl_hours),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def authenticate_user(db: Session, email: str, password: str) -> User:
    user = db.scalar(select(User).where(User.email == email))
    if user is None or not user.is_active or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return user


def get_user_by_token(db: Session, token: str) -> User:
    session = db.scalar(select(UserSession).where(UserSession.token == token))
    if session is None or session.expires_at < datetime.utcnow():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    user = db.scalar(select(User).where(User.user_id == session.user_id))
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Inactive user")
    return user
