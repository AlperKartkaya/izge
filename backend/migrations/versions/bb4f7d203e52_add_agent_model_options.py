"""Persist per-request model and tool choices without credentials."""
from alembic import op
import sqlalchemy as sa

revision = "bb4f7d203e52"
down_revision = "aa3e6b192d41"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("colleague_runs", sa.Column("agent_options", sa.JSON(), nullable=False, server_default="{}"))


def downgrade() -> None:
    op.drop_column("colleague_runs", "agent_options")
