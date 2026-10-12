from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import Artifact, ArtifactPermission, Signal, User


_PUBLIC_DEMO_SEED_BATCH = "pusula-b2b-demo-v1"


def signal_is_visible_to_artifact_ids(signal: Signal, allowed_artifact_ids: set[str]) -> bool:
    # Derived titles and summaries can quote a different document than their primary source.
    referenced_ids = {signal.source_artifact_id} if signal.source_artifact_id else set()

    def collect(value: object) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                if str(key).endswith("artifact_id") and isinstance(item, str) and item:
                    referenced_ids.add(item)
                elif str(key).endswith("artifact_ids") and isinstance(item, list):
                    referenced_ids.update(item_id for item_id in item if isinstance(item_id, str) and item_id)
                else:
                    collect(item)
        elif isinstance(value, list):
            for item in value:
                collect(item)

    collect(signal.payload_json)
    return bool(referenced_ids) and referenced_ids.issubset(allowed_artifact_ids)


def require_admin(user: User) -> None:
    if user.role != "Admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bu işlem için yönetici yetkisi gerekiyor.")


def artifact_is_visible_to_user(db: Session, artifact: Artifact, user: User) -> bool:
    if artifact.workspace_id != user.workspace_id:
        return False
    if user.is_public_demo:
        if artifact.uploaded_by == user.user_id:
            return True
        seed_markers = {part.strip() for part in (artifact.review_notes or "").split(";")}
        return artifact.visibility_scope == "workspace" and _PUBLIC_DEMO_SEED_BATCH in seed_markers
    # Conversation attachments inherit conversation membership; admin status must not open private chat files.
    if user.role == "Admin" and artifact.source_type != "team_chat_attachment":
        return True
    if artifact.visibility_scope == "workspace":
        return True
    permission = db.scalar(
        select(ArtifactPermission).where(
            ArtifactPermission.artifact_id == artifact.artifact_id,
            ArtifactPermission.user_id == user.user_id,
        )
    )
    return permission is not None or artifact.uploaded_by == user.user_id


def require_artifact_access(db: Session, artifact: Artifact, user: User) -> None:
    if not artifact_is_visible_to_user(db, artifact, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bu kaynağa erişim izniniz yok.")


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
                detail=f"Şirkette bulunmayan kullanıcılar: {', '.join(invalid_ids)}",
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
