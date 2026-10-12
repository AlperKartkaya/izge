from __future__ import annotations

import re

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import User
from app.services.security import get_user_by_token, public_demo_ip_hash, resolve_client_ip


_PUBLIC_DEMO_MUTATION_PATHS = (
    re.compile(r"^/work/conversations$"),
    re.compile(r"^/work/conversations/[^/]+$"),
    re.compile(r"^/work/ask$"),
    re.compile(r"^/team-chat/typing$"),
)


def get_bearer_token(request: Request, authorization: str | None = Header(default=None)) -> str:
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
        if token:
            return token
    session_cookie = request.cookies.get(get_settings().session_cookie_name)
    if session_cookie:
        return session_cookie
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Lütfen giriş yapın.")


def get_current_user(request: Request, token: str = Depends(get_bearer_token), db: Session = Depends(get_db)) -> User:
    user = get_user_by_token(db, token)
    if not user.is_public_demo:
        return user
    settings = get_settings()
    if not settings.public_demo_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Genel demo şu anda kapalı.")
    client_ip = resolve_client_ip(request)
    if client_ip is None or public_demo_ip_hash(client_ip) != user.public_demo_ip_hash:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Demo oturumu bu bağlantı için geçerli değil.")
    relative_path = request.url.path.removeprefix(settings.api_prefix)
    if request.method not in {"GET", "HEAD", "OPTIONS"} and not any(pattern.match(relative_path) for pattern in _PUBLIC_DEMO_MUTATION_PATHS):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Genel demo şirket verilerini değiştiremez.")
    return user
