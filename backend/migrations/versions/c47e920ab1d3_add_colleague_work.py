"""add colleague work tables

Revision ID: c47e920ab1d3
Revises: a91d73b5f4c2
Create Date: 2026-10-08 17:30:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "c47e920ab1d3"
down_revision = "a91d73b5f4c2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "work_tasks",
        sa.Column("task_id", sa.String(length=64), nullable=False),
        sa.Column("workspace_id", sa.String(length=64), nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("assignee_user_id", sa.String(length=64), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("due_at", sa.DateTime(), nullable=True),
        sa.Column("remind_at", sa.DateTime(), nullable=True),
        sa.Column("reminder_sent_at", sa.DateTime(), nullable=True),
        sa.Column("source_artifact_ids", sa.JSON(), nullable=False),
        sa.Column("source_snapshot", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["assignee_user_id"], ["users.user_id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.user_id"]),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.workspace_id"]),
        sa.PrimaryKeyConstraint("task_id"),
    )
    for column in ("workspace_id", "created_by", "assignee_user_id", "status", "due_at", "remind_at"):
        op.create_index(op.f(f"ix_work_tasks_{column}"), "work_tasks", [column], unique=False)

    op.create_table(
        "colleague_runs",
        sa.Column("run_id", sa.String(length=64), nullable=False),
        sa.Column("workspace_id", sa.String(length=64), nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("client_request_id", sa.String(length=120), nullable=True),
        sa.Column("idempotency_key", sa.String(length=120), nullable=True),
        sa.Column("thread_id", sa.String(length=80), nullable=False),
        sa.Column("thread_title", sa.String(length=120), nullable=False),
        sa.Column("thread_kind", sa.String(length=16), nullable=False),
        sa.Column("participant_user_ids", sa.JSON(), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("answer", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("sources", sa.JSON(), nullable=False),
        sa.Column("lease_owner", sa.String(length=255), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.user_id"]),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.workspace_id"]),
        sa.PrimaryKeyConstraint("run_id"),
        sa.UniqueConstraint("workspace_id", "client_request_id", name="uq_colleague_run_workspace_request"),
        sa.UniqueConstraint("workspace_id", "idempotency_key", name="uq_colleague_run_workspace_idempotency"),
    )
    for column in ("workspace_id", "created_by", "kind", "thread_id", "status", "lease_owner", "lease_expires_at"):
        op.create_index(op.f(f"ix_colleague_runs_{column}"), "colleague_runs", [column], unique=False)

    op.create_table(
        "colleague_run_events",
        sa.Column("event_id", sa.String(length=64), nullable=False),
        sa.Column("run_id", sa.String(length=64), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("stage_key", sa.String(length=64), nullable=True),
        sa.Column("label", sa.String(length=255), nullable=True),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["colleague_runs.run_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("event_id"),
        sa.UniqueConstraint("run_id", "sequence", name="uq_colleague_event_run_sequence"),
    )
    for column in ("run_id", "event_type", "created_at"):
        op.create_index(op.f(f"ix_colleague_run_events_{column}"), "colleague_run_events", [column], unique=False)


def downgrade() -> None:
    for column in ("created_at", "event_type", "run_id"):
        op.drop_index(op.f(f"ix_colleague_run_events_{column}"), table_name="colleague_run_events")
    op.drop_table("colleague_run_events")
    for column in ("lease_expires_at", "lease_owner", "status", "thread_id", "kind", "created_by", "workspace_id"):
        op.drop_index(op.f(f"ix_colleague_runs_{column}"), table_name="colleague_runs")
    op.drop_table("colleague_runs")
    for column in ("remind_at", "due_at", "status", "assignee_user_id", "created_by", "workspace_id"):
        op.drop_index(op.f(f"ix_work_tasks_{column}"), table_name="work_tasks")
    op.drop_table("work_tasks")
