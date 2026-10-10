"""Expand automation schedules and retain run history links."""
from alembic import op
import sqlalchemy as sa

revision = "aa3e6b192d41"
down_revision = "f0d5c3b9e024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("automations", sa.Column("frequency", sa.String(24), nullable=False, server_default="daily"))
    op.add_column("automations", sa.Column("starts_at", sa.DateTime()))
    op.add_column("automations", sa.Column("last_run_id", sa.String(64)))
    op.add_column("automations", sa.Column("last_scheduled_at", sa.DateTime()))
    op.execute("UPDATE automations SET last_scheduled_at = last_run_at WHERE last_run_at IS NOT NULL")


def downgrade() -> None:
    op.drop_column("automations", "last_scheduled_at")
    op.drop_column("automations", "last_run_id")
    op.drop_column("automations", "starts_at")
    op.drop_column("automations", "frequency")
