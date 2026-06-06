"""add company chat messages

Revision ID: a91d73b5f4c2
Revises: 605ffcaeb857
Create Date: 2026-05-26 16:30:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "a91d73b5f4c2"
down_revision = "605ffcaeb857"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "company_chat_messages",
        sa.Column("message_id", sa.String(length=64), nullable=False),
        sa.Column("workspace_id", sa.String(length=64), nullable=False),
        sa.Column("author_user_id", sa.String(length=64), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("message_metadata", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["author_user_id"], ["users.user_id"]),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.workspace_id"]),
        sa.PrimaryKeyConstraint("message_id"),
    )
    op.create_index(op.f("ix_company_chat_messages_author_user_id"), "company_chat_messages", ["author_user_id"], unique=False)
    op.create_index(op.f("ix_company_chat_messages_created_at"), "company_chat_messages", ["created_at"], unique=False)
    op.create_index(op.f("ix_company_chat_messages_workspace_id"), "company_chat_messages", ["workspace_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_company_chat_messages_workspace_id"), table_name="company_chat_messages")
    op.drop_index(op.f("ix_company_chat_messages_created_at"), table_name="company_chat_messages")
    op.drop_index(op.f("ix_company_chat_messages_author_user_id"), table_name="company_chat_messages")
    op.drop_table("company_chat_messages")
