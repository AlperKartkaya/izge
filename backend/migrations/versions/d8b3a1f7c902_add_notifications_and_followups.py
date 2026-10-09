"""add notifications and colleague follow-ups

Revision ID: d8b3a1f7c902
Revises: c47e920ab1d3
Create Date: 2026-10-09 09:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "d8b3a1f7c902"
down_revision = "c47e920ab1d3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("colleague_runs") as batch_op:
        batch_op.add_column(sa.Column("context_artifact_ids", sa.JSON(), nullable=False, server_default="[]"))
        batch_op.add_column(sa.Column("follow_ups", sa.JSON(), nullable=False, server_default="[]"))

    op.create_table(
        "notifications",
        sa.Column("notification_id", sa.String(length=64), nullable=False),
        sa.Column("workspace_id", sa.String(length=64), nullable=False),
        sa.Column("recipient_user_id", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("thread_id", sa.String(length=80), nullable=True),
        sa.Column("run_id", sa.String(length=64), nullable=True),
        sa.Column("message_id", sa.String(length=64), nullable=True),
        sa.Column("source_key", sa.String(length=160), nullable=False),
        sa.Column("read_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["message_id"], ["company_chat_messages.message_id"]),
        sa.ForeignKeyConstraint(["recipient_user_id"], ["users.user_id"]),
        sa.ForeignKeyConstraint(["run_id"], ["colleague_runs.run_id"]),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.workspace_id"]),
        sa.PrimaryKeyConstraint("notification_id"),
        sa.UniqueConstraint("recipient_user_id", "source_key", name="uq_notification_recipient_source"),
    )
    for column in ("workspace_id", "recipient_user_id", "kind", "thread_id", "run_id", "message_id", "read_at", "created_at"):
        op.create_index(op.f(f"ix_notifications_{column}"), "notifications", [column], unique=False)


def downgrade() -> None:
    for column in ("created_at", "read_at", "message_id", "run_id", "thread_id", "kind", "recipient_user_id", "workspace_id"):
        op.drop_index(op.f(f"ix_notifications_{column}"), table_name="notifications")
    op.drop_table("notifications")
    with op.batch_alter_table("colleague_runs") as batch_op:
        batch_op.drop_column("follow_ups")
        batch_op.drop_column("context_artifact_ids")
