"""add daily colleague automations

Revision ID: e9c4b2a8d013
Revises: d8b3a1f7c902
"""
from alembic import op
import sqlalchemy as sa

revision = "e9c4b2a8d013"
down_revision = "d8b3a1f7c902"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "automations",
        sa.Column("automation_id", sa.String(64), primary_key=True),
        sa.Column("workspace_id", sa.String(64), sa.ForeignKey("workspace.workspace_id"), nullable=False),
        sa.Column("created_by", sa.String(64), sa.ForeignKey("users.user_id"), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("schedule_time", sa.String(5), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("last_run_at", sa.DateTime()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_automations_workspace_id", "automations", ["workspace_id"])
    op.create_index("ix_automations_created_by", "automations", ["created_by"])


def downgrade() -> None:
    op.drop_table("automations")
