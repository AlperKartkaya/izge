from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas.api import ScenarioImpactRead, ScenarioImpactRequest, ScenarioReplayRead, ScenarioRunListRead, ScenarioRunRead, ScenarioTemplateCatalogItem
from app.services.scenario_support import (
    build_scenario_impact,
    get_scenario_run,
    list_scenario_runs,
    list_scenario_templates,
    replay_scenario_run,
)

router = APIRouter(prefix="/scenario", tags=["scenario"])


@router.post("/impact", response_model=ScenarioImpactRead)
def scenario_impact(payload: ScenarioImpactRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> ScenarioImpactRead:
    return ScenarioImpactRead(**build_scenario_impact(db, current_user, scenario_text=payload.scenario_text, limit=payload.limit, persist_run=True))


@router.get("/templates", response_model=list[ScenarioTemplateCatalogItem])
def scenario_templates(_current_user: User = Depends(get_current_user)) -> list[ScenarioTemplateCatalogItem]:
    return [ScenarioTemplateCatalogItem(**template) for template in list_scenario_templates()]


@router.get("/runs", response_model=ScenarioRunListRead)
def scenario_runs(
    limit: int = Query(default=30, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ScenarioRunListRead:
    return ScenarioRunListRead(**list_scenario_runs(db, current_user, limit=limit))


@router.get("/runs/{scenario_run_id}", response_model=ScenarioRunRead)
def scenario_run_detail(
    scenario_run_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ScenarioRunRead:
    payload = get_scenario_run(db, current_user, scenario_run_id)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scenario run not found")
    return ScenarioRunRead(**payload)


@router.post("/runs/{scenario_run_id}/replay", response_model=ScenarioReplayRead)
def scenario_run_replay(
    scenario_run_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ScenarioReplayRead:
    payload = replay_scenario_run(db, current_user, scenario_run_id)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scenario run not found")
    return ScenarioReplayRead(**payload)
