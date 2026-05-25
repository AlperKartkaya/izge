from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas.api import MemoryFilesystemRead, OrchestrationBlueprintRead
from app.services.evidence_substrate import build_memory_filesystem, build_orchestration_blueprint

router = APIRouter(prefix="/evidence-substrate", tags=["evidence-substrate"])


@router.get("/filesystem", response_model=MemoryFilesystemRead)
def get_memory_filesystem(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> MemoryFilesystemRead:
    return MemoryFilesystemRead(**build_memory_filesystem(db, current_user))


@router.get("/orchestration", response_model=OrchestrationBlueprintRead)
def get_orchestration_blueprint(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> OrchestrationBlueprintRead:
    return OrchestrationBlueprintRead(**build_orchestration_blueprint(db, current_user))
