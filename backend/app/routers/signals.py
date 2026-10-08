from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas.api import SignalDetail, SignalRead
from app.services.querying import get_persisted_signal_detail, list_persisted_signals

router = APIRouter(prefix="/signals", tags=["signals"])


@router.get("", response_model=list[SignalRead])
def list_signals(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[SignalRead]:
    return list_persisted_signals(db, current_user)


@router.get("/{signal_id}", response_model=SignalDetail)
def get_signal_detail(signal_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> SignalDetail:
    signal = get_persisted_signal_detail(db, current_user, signal_id)
    if signal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sinyal bulunamadı.")
    return signal
