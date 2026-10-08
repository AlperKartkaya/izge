from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas.api import UserCreate, UserRead, UserUpdate
from app.services.audit import log_event
from app.services.permissions import require_admin
from app.services.security import hash_password
from app.services.colleague import AGENT_EMAIL, ensure_colleague_user

router = APIRouter(tags=["users"])


@router.get("/users/me", response_model=UserRead)
def read_current_user(current_user: User = Depends(get_current_user)) -> UserRead:
    return UserRead.model_validate(current_user)


@router.get("/users", response_model=list[UserRead])
def list_users(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[UserRead]:
    require_admin(current_user)
    users = db.scalars(select(User).where(User.workspace_id == current_user.workspace_id).order_by(User.created_at.asc())).all()
    return [UserRead.model_validate(user) for user in users]


@router.get("/users/colleagues", response_model=list[UserRead])
def list_colleagues(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[UserRead]:
    ensure_colleague_user(db, current_user.workspace_id)
    users = db.scalars(
        select(User)
        .where(
            User.workspace_id == current_user.workspace_id,
            User.user_id != current_user.user_id,
            User.email != AGENT_EMAIL,
            User.role != "Admin",
            User.is_active.is_(True),
        )
        .order_by(User.created_at.asc())
    ).all()
    return [UserRead.model_validate(user) for user in users]


@router.post("/users", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> UserRead:
    require_admin(current_user)
    existing = db.scalar(select(User).where(User.email == payload.email))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User email already exists")
    user = User(
        workspace_id=current_user.workspace_id,
        role=payload.role,
        display_name=payload.display_name,
        email=payload.email,
        password_hash=hash_password(payload.password),
        is_active=payload.is_active,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    log_event(
        db,
        workspace_id=current_user.workspace_id,
        actor_user_id=current_user.user_id,
        event_type="USER_CREATED",
        target_type="user",
        target_id=user.user_id,
        event_metadata={"role": user.role, "email": user.email},
    )
    return UserRead.model_validate(user)


@router.patch("/users/{user_id}", response_model=UserRead)
def update_user(user_id: str, payload: UserUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> UserRead:
    require_admin(current_user)
    user = db.scalar(select(User).where(User.user_id == user_id, User.workspace_id == current_user.workspace_id))
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    changed_fields: dict[str, str | bool] = {}
    if payload.display_name is not None:
        user.display_name = payload.display_name
        changed_fields["display_name"] = payload.display_name
    if payload.role is not None:
        user.role = payload.role
        changed_fields["role"] = payload.role
    if payload.is_active is not None:
        user.is_active = payload.is_active
        changed_fields["is_active"] = payload.is_active
    if payload.password is not None:
        user.password_hash = hash_password(payload.password)
        changed_fields["password_reset"] = True
    db.commit()
    db.refresh(user)
    if changed_fields:
        log_event(
            db,
            workspace_id=current_user.workspace_id,
            actor_user_id=current_user.user_id,
            event_type="USER_UPDATED",
            target_type="user",
            target_id=user.user_id,
            event_metadata=changed_fields,
        )
    return UserRead.model_validate(user)
