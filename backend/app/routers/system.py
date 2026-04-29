from fastapi import APIRouter, Depends

from app.dependencies import get_current_user
from app.models import User
from app.schemas.api import LocalLLMSmokeRead, LocalLLMStatusRead
from app.services.llm_status import inspect_local_llm_status, run_local_llm_smoke
from app.services.permissions import require_admin

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/llm-status", response_model=LocalLLMStatusRead)
def get_local_llm_status(current_user: User = Depends(get_current_user)) -> LocalLLMStatusRead:
    require_admin(current_user)
    return LocalLLMStatusRead(**inspect_local_llm_status())


@router.post("/llm-smoke", response_model=LocalLLMSmokeRead)
def smoke_local_llm(current_user: User = Depends(get_current_user)) -> LocalLLMSmokeRead:
    require_admin(current_user)
    return LocalLLMSmokeRead(**run_local_llm_smoke())
