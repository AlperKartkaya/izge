from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_user
from app.models import QueryRun, User
from app.schemas.api import QueryCreate, QueryResult
from app.services.querying import build_query_result_for_reader, execute_query

router = APIRouter(prefix="/query", tags=["query"])


@router.post("", response_model=QueryResult, status_code=status.HTTP_201_CREATED)
def submit_query(payload: QueryCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> QueryResult:
    query_run = execute_query(db, query_text=payload.query_text, actor=current_user)
    return build_query_result_for_reader(db, query_run, current_user)


@router.get("/{query_run_id}", response_model=QueryResult)
def get_query_result(query_run_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> QueryResult:
    query_run = db.scalar(select(QueryRun).where(QueryRun.query_run_id == query_run_id, QueryRun.workspace_id == current_user.workspace_id))
    if query_run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Query run not found")
    if current_user.role != "Admin" and query_run.created_by != current_user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Query result access denied")
    return build_query_result_for_reader(db, query_run, current_user)
