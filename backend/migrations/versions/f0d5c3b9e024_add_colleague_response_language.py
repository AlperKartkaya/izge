"""Persist the selected response language without changing existing answers."""
from alembic import op
import sqlalchemy as sa

revision = "f0d5c3b9e024"
down_revision = "e9c4b2a8d013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("colleague_runs", sa.Column("response_language", sa.String(2), nullable=False, server_default="tr"))
    op.add_column("automations", sa.Column("response_language", sa.String(2), nullable=False, server_default="tr"))


def downgrade() -> None:
    op.drop_column("automations", "response_language")
    op.drop_column("colleague_runs", "response_language")
