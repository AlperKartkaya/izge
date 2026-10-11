"""One permission boundary for file and read-only tool evidence."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Artifact, User
from app.services.permissions import artifact_is_visible_to_user


def artifact_source_ids(sources: list[dict]) -> list[str]:
    return [str(source["artifact_id"]) for source in sources if source.get("artifact_id") and source.get("source_type", "artifact") == "artifact"]


def visible_sources(db: Session, reader: User, sources: list[dict]) -> list[dict]:
    from app.services.agent_tools import source_visible_to_reader

    ids = artifact_source_ids(sources)
    artifacts = db.scalars(select(Artifact).where(Artifact.workspace_id == reader.workspace_id, Artifact.artifact_id.in_(ids))).all() if ids else []
    visible_ids = {artifact.artifact_id for artifact in artifacts if artifact_is_visible_to_user(db, artifact, reader)}
    return [source for source in sources if (
        source.get("artifact_id") in visible_ids if source.get("source_type", "artifact") == "artifact"
        else source_visible_to_reader(source, reader)
    )]
