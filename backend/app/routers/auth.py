from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import User, Workspace
from app.schemas.api import SignInRequest, TokenResponse, UserRead
from app.services.audit import log_event
from app.services.security import (
    authenticate_user,
    create_session,
    enforce_sign_in_rate_limit,
    get_user_by_token,
    record_sign_in_failure,
    record_sign_in_success,
    revoke_session_token,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _client_host(request: Request) -> str | None:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",", maxsplit=1)[0].strip()
    return request.client.host if request.client else None


def _cookie_secure(request: Request) -> bool:
    return request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").lower() == "https"


def _set_session_cookie(response: Response, request: Request, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=max(settings.token_ttl_hours, 1) * 3600,
        httponly=True,
        secure=_cookie_secure(request),
        samesite="lax",
        path="/",
    )


def _clear_session_cookie(response: Response, request: Request) -> None:
    response.delete_cookie(
        get_settings().session_cookie_name,
        path="/",
        secure=_cookie_secure(request),
        httponly=True,
        samesite="lax",
    )


def _log_failed_sign_in(db: Session, request: Request, email: str) -> None:
    workspace = db.scalar(select(Workspace))
    if workspace is None:
        return
    log_event(
        db,
        workspace_id=workspace.workspace_id,
        actor_user_id=None,
        event_type="USER_SIGN_IN_FAILED",
        target_type="auth",
        target_id=email.lower(),
        event_metadata={"client_host": _client_host(request)},
    )


def _extract_token(authorization: str | None, request: Request) -> str | None:
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
        if token:
            return token
    return request.cookies.get(get_settings().session_cookie_name)


@router.post("/sign-in", response_model=TokenResponse)
def sign_in(payload: SignInRequest, request: Request, response: Response, db: Session = Depends(get_db)) -> TokenResponse:
    client_host = _client_host(request)
    enforce_sign_in_rate_limit(client_host=client_host, email=payload.email)
    try:
        user = authenticate_user(db, payload.email, payload.password)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_401_UNAUTHORIZED:
            record_sign_in_failure(client_host=client_host, email=payload.email)
            _log_failed_sign_in(db, request, payload.email)
        raise
    record_sign_in_success(client_host=client_host, email=payload.email)
    session, raw_token = create_session(db, user)
    _set_session_cookie(response, request, raw_token)
    log_event(
        db,
        workspace_id=user.workspace_id,
        actor_user_id=user.user_id,
        event_type="USER_SIGN_IN",
        target_type="user",
        target_id=user.user_id,
        event_metadata={"session_id": session.session_id},
    )
    return TokenResponse(access_token=raw_token, expires_at=session.expires_at, user=UserRead.model_validate(user))


@router.post("/sign-out")
def sign_out(
    request: Request,
    response: Response,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    token = _extract_token(authorization, request)
    current_user: User | None = None

    if token:
        try:
            current_user = get_user_by_token(db, token)
        except HTTPException:
            current_user = None
        revoke_session_token(db, token)
    _clear_session_cookie(response, request)
    if current_user is not None:
        log_event(
            db,
            workspace_id=current_user.workspace_id,
            actor_user_id=current_user.user_id,
            event_type="USER_SIGN_OUT",
            target_type="user",
            target_id=current_user.user_id,
            event_metadata={},
        )
    return {"status": "signed_out"}
