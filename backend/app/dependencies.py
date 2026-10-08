from __future__ import annotations

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import User
from app.services.security import get_user_by_token


def get_bearer_token(request: Request, authorization: str | None = Header(default=None)) -> str:
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
        if token:
            return token
    session_cookie = request.cookies.get(get_settings().session_cookie_name)
    if session_cookie:
        return session_cookie
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Lütfen giriş yapın.")


def get_current_user(token: str = Depends(get_bearer_token), db: Session = Depends(get_db)) -> User:
    return get_user_by_token(db, token)
