from __future__ import annotations

import argparse
from pathlib import Path
from typing import Literal

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text

from app.db import engine
from app.schema import REQUIRED_SCHEMA_COLUMNS, assert_required_schema_ready, ensure_legacy_schema_compatibility

BACKEND_ROOT = Path(__file__).resolve().parents[1]
ALEMBIC_INI = BACKEND_ROOT / "alembic.ini"
MIGRATIONS_DIR = BACKEND_ROOT / "migrations"
APP_TABLES = set(REQUIRED_SCHEMA_COLUMNS) - {"orchestration_jobs"}

MigrationAction = Literal["upgrade", "legacy-stamp", "check"]


def make_alembic_config() -> Config:
    config = Config(str(ALEMBIC_INI))
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    return config


def _has_alembic_version() -> bool:
    with engine.connect() as connection:
        inspector = inspect(connection)
        return inspector.has_table("alembic_version")


def _has_existing_application_schema() -> bool:
    with engine.connect() as connection:
        inspector = inspect(connection)
        table_names = set(inspector.get_table_names())
        return bool(table_names & APP_TABLES)


def _current_revision() -> str | None:
    with engine.connect() as connection:
        inspector = inspect(connection)
        if not inspector.has_table("alembic_version"):
            return None
        return connection.execute(text("SELECT version_num FROM alembic_version LIMIT 1")).scalar_one_or_none()


def upgrade_database() -> dict[str, str | None]:
    """Bring the configured company database to the Alembic head.

    Fresh databases run the baseline migration. Pre-Alembic databases are
    non-destructively repaired with the old additive bootstrap path, verified,
    then stamped at head so future schema changes are versioned explicitly.
    """

    config = make_alembic_config()
    if _has_alembic_version():
        command.upgrade(config, "head")
        action: MigrationAction = "upgrade"
    elif _has_existing_application_schema():
        ensure_legacy_schema_compatibility(engine)
        command.stamp(config, "head")
        action = "legacy-stamp"
    else:
        command.upgrade(config, "head")
        action = "upgrade"

    with engine.begin() as connection:
        assert_required_schema_ready(connection)
    return {"action": action, "revision": _current_revision()}


def stamp_current_database() -> dict[str, str | None]:
    """Verify a pre-existing schema and stamp it at head without creating rows."""

    ensure_legacy_schema_compatibility(engine)
    config = make_alembic_config()
    command.stamp(config, "head")
    with engine.begin() as connection:
        assert_required_schema_ready(connection)
    return {"action": "legacy-stamp", "revision": _current_revision()}


def check_database() -> dict[str, str | None]:
    with engine.begin() as connection:
        assert_required_schema_ready(connection)
    return {"action": "check", "revision": _current_revision()}


def main() -> None:
    parser = argparse.ArgumentParser(description="Izge database migration/version tooling")
    parser.add_argument("command", choices=("upgrade", "stamp-current", "check"))
    args = parser.parse_args()

    if args.command == "upgrade":
        result = upgrade_database()
    elif args.command == "stamp-current":
        result = stamp_current_database()
    else:
        result = check_database()
    print(f"izge-db {result['action']} revision={result['revision'] or 'none'}")


if __name__ == "__main__":
    main()
