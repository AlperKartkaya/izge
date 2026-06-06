from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import SessionLocal
from app.routers.admin_data import router as admin_data_router
from app.routers.analysis import router as analysis_router
from app.routers.artifacts import router as artifacts_router
from app.routers.audit import router as audit_router
from app.routers.evidence import router as evidence_router
from app.routers.auth import router as auth_router
from app.routers.graph import router as graph_router
from app.routers.ingestion import router as ingestion_router
from app.routers.memory import router as memory_router
from app.routers.operations import router as operations_router
from app.routers.query import router as query_router
from app.routers.scenario import router as scenario_router
from app.routers.signals import router as signals_router
from app.routers.system import router as system_router
from app.routers.team_chat import router as team_chat_router
from app.routers.users import router as users_router
from app.services.bootstrap import initialize_database, seed_defaults


@asynccontextmanager
async def lifespan(_app: FastAPI):
    initialize_database()
    db: Session = SessionLocal()
    try:
        seed_defaults(db)
    finally:
        db.close()
    yield


settings = get_settings()
app = FastAPI(title=settings.app_name, lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(auth_router, prefix=settings.api_prefix)
app.include_router(users_router, prefix=settings.api_prefix)
app.include_router(artifacts_router, prefix=settings.api_prefix)
app.include_router(ingestion_router, prefix=settings.api_prefix)
app.include_router(query_router, prefix=settings.api_prefix)
app.include_router(signals_router, prefix=settings.api_prefix)
app.include_router(system_router, prefix=settings.api_prefix)
app.include_router(team_chat_router, prefix=settings.api_prefix)
app.include_router(graph_router, prefix=settings.api_prefix)
app.include_router(memory_router, prefix=settings.api_prefix)
app.include_router(operations_router, prefix=settings.api_prefix)
app.include_router(analysis_router, prefix=settings.api_prefix)
app.include_router(audit_router, prefix=settings.api_prefix)
app.include_router(evidence_router, prefix=settings.api_prefix)
app.include_router(scenario_router, prefix=settings.api_prefix)
app.include_router(admin_data_router, prefix=settings.api_prefix)
