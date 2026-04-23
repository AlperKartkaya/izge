from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.api import SignInRequest, TokenResponse, UserRead
from app.services.audit import log_event
from app.services.security import authenticate_user, create_session

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/sign-in", response_model=TokenResponse)
def sign_in(payload: SignInRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = authenticate_user(db, payload.email, payload.password)
    session = create_session(db, user)
    log_event(
        db,
        workspace_id=user.workspace_id,
        actor_user_id=user.user_id,
        event_type="USER_SIGN_IN",
        target_type="user",
        target_id=user.user_id,
        event_metadata={"session_id": session.session_id},
    )
    return TokenResponse(access_token=session.token, expires_at=session.expires_at, user=UserRead.model_validate(user))
