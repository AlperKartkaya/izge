from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import Artifact, ArtifactPermission, User


def require_admin(user: User) -> None:
    if user.role != "Admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")


def artifact_is_visible_to_user(db: Session, artifact: Artifact, user: User) -> bool:
    if user.role == "Admin":
        return True
    if artifact.visibility_scope == "workspace":
        return artifact.workspace_id == user.workspace_id
    permission = db.scalar(
        select(ArtifactPermission).where(
            ArtifactPermission.artifact_id == artifact.artifact_id,
            ArtifactPermission.user_id == user.user_id,
        )
    )
    return permission is not None or artifact.uploaded_by == user.user_id


def require_artifact_access(db: Session, artifact: Artifact, user: User) -> None:
    if not artifact_is_visible_to_user(db, artifact, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Artifact access denied")


def set_artifact_permissions(
    db: Session,
    *,
    artifact: Artifact,
    actor: User,
    permitted_user_ids: list[str],
) -> None:
    db.execute(delete(ArtifactPermission).where(ArtifactPermission.artifact_id == artifact.artifact_id))
    if artifact.visibility_scope == "restricted":
        users = db.scalars(
            select(User).where(User.workspace_id == artifact.workspace_id, User.user_id.in_(set(permitted_user_ids + [artifact.uploaded_by])))
        ).all()
        valid_ids = {user.user_id for user in users}
        requested_ids = set(permitted_user_ids + [artifact.uploaded_by])
        invalid_ids = sorted(requested_ids - valid_ids)
        if invalid_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown or out-of-workspace permitted users: {', '.join(invalid_ids)}",
            )
        unique_ids = sorted(valid_ids)
        for user_id in unique_ids:
            db.add(
                ArtifactPermission(
                    workspace_id=artifact.workspace_id,
                    artifact_id=artifact.artifact_id,
                    user_id=user_id,
                    granted_by=actor.user_id,
                )
            )
    db.commit()


def list_permitted_user_ids(db: Session, artifact_id: str) -> list[str]:
    rows = db.scalars(select(ArtifactPermission.user_id).where(ArtifactPermission.artifact_id == artifact_id)).all()
    return list(rows)
