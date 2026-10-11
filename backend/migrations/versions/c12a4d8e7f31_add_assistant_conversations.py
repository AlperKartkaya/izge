"""add per-user assistant conversations

Revision ID: c12a4d8e7f31
Revises: bb4f7d203e52
Create Date: 2026-10-11 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "c12a4d8e7f31"
down_revision = "bb4f7d203e52"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "assistant_conversations",
        sa.Column("conversation_id", sa.String(length=64), nullable=False),
        sa.Column("workspace_id", sa.String(length=64), nullable=False),
        sa.Column("owner_user_id", sa.String(length=64), nullable=False),
        sa.Column("thread_id", sa.String(length=80), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("archived_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.user_id"]),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.workspace_id"]),
        sa.PrimaryKeyConstraint("conversation_id"),
        sa.UniqueConstraint("workspace_id", "owner_user_id", "thread_id", name="uq_assistant_conversation_owner_thread"),
    )
    for column in ("workspace_id", "owner_user_id", "thread_id", "archived_at", "deleted_at"):
        op.create_index(op.f(f"ix_assistant_conversations_{column}"), "assistant_conversations", [column], unique=False)


def downgrade() -> None:
    op.drop_table("assistant_conversations")
