import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import User, Workspace
from app.schemas.api import PublicDemoConfigRead, PublicDemoPersonaRead, PublicDemoSignInRequest, SignInRequest, TokenResponse, UserRead
from app.services.audit import log_event
from app.services.security import (
    authenticate_user,
    create_session,
    consume_public_demo_quota,
    enforce_sign_in_rate_limit,
    get_user_by_token,
    record_sign_in_failure,
    record_sign_in_success,
    revoke_session_token,
    hash_password,
    public_demo_ip_hash,
    resolve_client_ip,
)

router = APIRouter(prefix="/auth", tags=["auth"])

_PUBLIC_DEMO_WORKSPACE = "Pusula Yazılım ve IT Danışmanlık"
_PUBLIC_DEMO_VISITOR_COOKIE = "izge_demo_visitor"
_PUBLIC_DEMO_PERSONAS = {
    "kerem": {"name": "Kerem Demir", "title": "Software Engineer", "email": "kerem@pusula.demo"},
    "selin": {"name": "Selin Aras", "title": "Team Lead", "email": "selin@pusula.demo"},
}


def _client_host(request: Request) -> str | None:
    return resolve_client_ip(request)


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


@router.get("/demo", response_model=PublicDemoConfigRead)
def public_demo_config() -> PublicDemoConfigRead:
    settings = get_settings()
    return PublicDemoConfigRead(
        enabled=settings.public_demo_enabled,
        hourly_limit=max(settings.public_demo_hourly_limit, 1),
        personas=[
            PublicDemoPersonaRead(id=persona_id, name=spec["name"], title=spec["title"])
            for persona_id, spec in _PUBLIC_DEMO_PERSONAS.items()
        ],
    )


@router.post("/demo/sign-in", response_model=TokenResponse)
def public_demo_sign_in(
    payload: PublicDemoSignInRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> TokenResponse:
    settings = get_settings()
    if not settings.public_demo_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Genel demo etkin değil.")
    client_ip = resolve_client_ip(request)
    if client_ip is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="İstemci adresi doğrulanamadı.")
    ip_hash = public_demo_ip_hash(client_ip)
    raw_visitor_id = request.cookies.get(_PUBLIC_DEMO_VISITOR_COOKIE, "")
    if len(raw_visitor_id) < 32 or len(raw_visitor_id) > 128:
        raw_visitor_id = secrets.token_urlsafe(32)
    visitor_hash = public_demo_ip_hash(f"visitor:{raw_visitor_id}")
    spec = _PUBLIC_DEMO_PERSONAS[payload.persona]
    workspace = db.scalar(select(Workspace).where(Workspace.name == _PUBLIC_DEMO_WORKSPACE))
    source_persona = db.scalar(select(User).where(User.email == spec["email"], User.is_public_demo.is_(False)))
    if workspace is None or source_persona is None or source_persona.workspace_id != workspace.workspace_id:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Demo verisi henüz hazır değil.")
    user = db.scalar(select(User).where(
        User.is_public_demo.is_(True),
        User.public_demo_visitor_hash == visitor_hash,
        User.public_demo_persona == payload.persona,
    ))
    if user is None:
        user = User(
            workspace_id=workspace.workspace_id,
            role="Member",
            display_name=spec["name"],
            email=f"demo-{visitor_hash[:24]}-{payload.persona}@public-demo.invalid",
            password_hash=hash_password(secrets.token_urlsafe(32)),
            is_public_demo=True,
            public_demo_persona=payload.persona,
            public_demo_ip_hash=ip_hash,
            public_demo_visitor_hash=visitor_hash,
        )
        consume_public_demo_quota(ip_hash=public_demo_ip_hash(f"sign-in:{client_ip}"), limit=30)
        db.add(user)
        try:
            db.commit()
            db.refresh(user)
        except IntegrityError:
            db.rollback()
            user = db.scalar(select(User).where(
                User.is_public_demo.is_(True),
                User.public_demo_visitor_hash == visitor_hash,
                User.public_demo_persona == payload.persona,
            ))
            if user is None:
                raise
    elif user.public_demo_ip_hash != ip_hash:
        user.public_demo_ip_hash = ip_hash
        db.commit()
    session, raw_token = create_session(db, user)
    _set_session_cookie(response, request, raw_token)
    response.set_cookie(
        _PUBLIC_DEMO_VISITOR_COOKIE,
        raw_visitor_id,
        max_age=365 * 24 * 3600,
        httponly=True,
        secure=_cookie_secure(request),
        samesite="lax",
        path="/",
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
