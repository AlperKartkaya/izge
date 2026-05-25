from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas.api import ScenarioImpactRead, ScenarioImpactRequest, ScenarioTemplateCatalogItem
from app.services.scenario_support import build_scenario_impact, list_scenario_templates

router = APIRouter(prefix="/scenario", tags=["scenario"])


@router.post("/impact", response_model=ScenarioImpactRead)
def scenario_impact(payload: ScenarioImpactRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> ScenarioImpactRead:
    return ScenarioImpactRead(**build_scenario_impact(db, current_user, scenario_text=payload.scenario_text, limit=payload.limit))


@router.get("/templates", response_model=list[ScenarioTemplateCatalogItem])
def scenario_templates(_current_user: User = Depends(get_current_user)) -> list[ScenarioTemplateCatalogItem]:
    return [ScenarioTemplateCatalogItem(**template) for template in list_scenario_templates()]
