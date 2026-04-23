from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas.api import AssumptionDriftItem, ContradictionItem
from app.services.querying import list_ranked_assumption_drift, list_ranked_contradictions

router = APIRouter(tags=["analysis"])


@router.get("/contradictions", response_model=list[ContradictionItem])
def list_contradictions(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[ContradictionItem]:
    return [ContradictionItem(**item) for item in list_ranked_contradictions(db, current_user)]


@router.get("/assumptions/drift", response_model=list[AssumptionDriftItem])
def list_assumption_drift(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[AssumptionDriftItem]:
    return [AssumptionDriftItem(**item) for item in list_ranked_assumption_drift(db, current_user)]
