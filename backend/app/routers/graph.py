from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas.api import GraphSummary, GraphTimeline
from app.services.querying import graph_summary, graph_timeline

router = APIRouter(prefix="/graph", tags=["graph"])


@router.get("/summary", response_model=GraphSummary)
def get_graph_summary(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> GraphSummary:
    memory_counts, edge_counts, artifact_count = graph_summary(db, current_user)
    return GraphSummary(
        workspace_id=current_user.workspace_id,
        artifact_count=artifact_count,
        memory_counts=memory_counts,
        edge_counts=edge_counts,
    )


@router.get("/timeline", response_model=GraphTimeline)
def get_graph_timeline(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> GraphTimeline:
    return GraphTimeline(
        workspace_id=current_user.workspace_id,
        items=graph_timeline(db, current_user),
    )
