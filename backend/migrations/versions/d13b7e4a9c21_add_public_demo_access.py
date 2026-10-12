"""Add isolated public demo identities and durable IP quotas."""

from alembic import op
import sqlalchemy as sa


revision = "d13b7e4a9c21"
down_revision = "c12a4d8e7f31"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("is_public_demo", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("users", sa.Column("public_demo_persona", sa.String(length=32)))
    op.add_column("users", sa.Column("public_demo_ip_hash", sa.String(length=64)))
    op.add_column("users", sa.Column("public_demo_visitor_hash", sa.String(length=64)))
    op.create_index(op.f("ix_users_is_public_demo"), "users", ["is_public_demo"], unique=False)
    op.create_index(op.f("ix_users_public_demo_persona"), "users", ["public_demo_persona"], unique=False)
    op.create_index(op.f("ix_users_public_demo_ip_hash"), "users", ["public_demo_ip_hash"], unique=False)
    op.create_index(op.f("ix_users_public_demo_visitor_hash"), "users", ["public_demo_visitor_hash"], unique=False)
    op.create_index(
        "uq_public_demo_visitor_persona",
        "users",
        ["public_demo_visitor_hash", "public_demo_persona"],
        unique=True,
    )
    op.create_table(
        "public_demo_quotas",
        sa.Column("quota_id", sa.String(length=64), nullable=False),
        sa.Column("ip_hash", sa.String(length=64), nullable=False),
        sa.Column("window_started_at", sa.DateTime(), nullable=False),
        sa.Column("request_count", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("quota_id"),
        sa.UniqueConstraint("ip_hash", "window_started_at", name="uq_public_demo_quota_ip_window"),
    )
    op.create_index(op.f("ix_public_demo_quotas_ip_hash"), "public_demo_quotas", ["ip_hash"], unique=False)
    op.create_index(op.f("ix_public_demo_quotas_window_started_at"), "public_demo_quotas", ["window_started_at"], unique=False)


def downgrade() -> None:
    op.drop_table("public_demo_quotas")
    op.drop_index("uq_public_demo_visitor_persona", table_name="users")
    op.drop_index(op.f("ix_users_public_demo_visitor_hash"), table_name="users")
    op.drop_index(op.f("ix_users_public_demo_ip_hash"), table_name="users")
    op.drop_index(op.f("ix_users_public_demo_persona"), table_name="users")
    op.drop_index(op.f("ix_users_is_public_demo"), table_name="users")
    op.drop_column("users", "public_demo_ip_hash")
    op.drop_column("users", "public_demo_visitor_hash")
    op.drop_column("users", "public_demo_persona")
    op.drop_column("users", "is_public_demo")
