from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas.api import GraphNeighborhood, GraphSummary, GraphTimeline, TemporalGraphRead
from app.services.querying import graph_neighborhood, graph_summary, graph_timeline
from app.services.temporal_graph import build_temporal_graph

router = APIRouter(prefix="/graph", tags=["graph"])


@router.get("/summary", response_model=GraphSummary)
def get_graph_summary(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> GraphSummary:
    memory_counts, edge_counts, artifact_count, signal_counts = graph_summary(db, current_user)
    return GraphSummary(
        workspace_id=current_user.workspace_id,
        artifact_count=artifact_count,
        memory_counts=memory_counts,
        edge_counts=edge_counts,
        signal_counts=signal_counts,
    )


@router.get("/timeline", response_model=GraphTimeline)
def get_graph_timeline(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> GraphTimeline:
    return GraphTimeline(
        workspace_id=current_user.workspace_id,
        items=graph_timeline(db, current_user),
    )


@router.get("/neighborhood/{memory_type}/{memory_id}", response_model=GraphNeighborhood)
def get_graph_neighborhood(
    memory_type: str,
    memory_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> GraphNeighborhood:
    neighborhood = graph_neighborhood(db, current_user, memory_type=memory_type, memory_id=memory_id)
    if neighborhood is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Graph neighborhood not found")
    return neighborhood


@router.get("/temporal", response_model=TemporalGraphRead)
def get_temporal_graph(
    limit: int = 80,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TemporalGraphRead:
    bounded_limit = max(1, min(limit, 200))
    return TemporalGraphRead(**build_temporal_graph(db, current_user, limit=bounded_limit))
