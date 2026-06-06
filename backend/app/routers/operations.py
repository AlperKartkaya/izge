from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas.api import OperationsOverviewRead
from app.services.operations import build_operations_overview
from app.services.permissions import require_admin

router = APIRouter(prefix="/operations", tags=["operations"])


@router.get("/overview", response_model=OperationsOverviewRead)
def get_operations_overview(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> OperationsOverviewRead:
    require_admin(current_user)
    return OperationsOverviewRead(**build_operations_overview(db, current_user))
