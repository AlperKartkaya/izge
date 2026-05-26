from __future__ import annotations

import json
import secrets
import textwrap
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import engine
from app.models import Artifact, CompanyChatMessage, User, Workspace
from app.schema import assert_required_schema_ready
from app.services.audit import log_event
from app.services.security import hash_password


DEMO_MEMBER_PASSWORD = "change-me-employee"
DEMO_OPS_PASSWORD = "change-me-ops"

DEMO_USERS = [
    {
        "display_name": "Demo Employee",
        "email": "employee@example.com",
        "password": DEMO_MEMBER_PASSWORD,
        "role": "Member",
    },
    {
        "display_name": "Operations Lead",
        "email": "ops@example.com",
        "password": DEMO_OPS_PASSWORD,
        "role": "Member",
    },
]

DEMO_ARTIFACT_SPECS = [
    {
        "title": "Northstar Payroll Q2 Product Strategy Report",
        "filename": "northstar-q2-product-strategy-report.pdf",
        "mime_type": "application/pdf",
        "format": "pdf",
        "lines": [
            "Northstar Payroll Q2 Product Strategy Report",
            "Date: 2026-04-08",
            "Decision: we decided to keep self-serve onboarding behind a controlled beta until activation instrumentation and security review pass.",
            "Assumption: we assumed manual onboarding could support enterprise expansion demand until 2026-06-30.",
            "Constraint: security review must approve data-retention controls before broad launch.",
            "Outcome: the April launch checkpoint showed manual onboarding reached 68 accounts but implementation quality risk increased.",
            "Commitment: Product operations will publish a launch readiness memo by 2026-04-12.",
        ],
    },
    {
        "title": "Northstar Payroll Internal Roadmap Presentation",
        "filename": "northstar-roadmap-presentation.pdf",
        "mime_type": "application/pdf",
        "format": "pdf",
        "lines": [
            "Northstar Payroll Internal Roadmap Presentation",
            "Date: 2026-03-26",
            "Slide 1 Decision: leadership chose to reintroduce a late Q2 self-serve onboarding launch to support the enterprise expansion pipeline.",
            "Slide 2 Assumption: growth expected that automated onboarding would reduce solution-engineering load by 30 percent.",
            "Slide 3 Constraint: onboarding analytics and release-control work must be complete before go-live.",
            "Slide 4 Commitment: Engineering will prepare the release-control checklist by 2026-04-10.",
            "Slide 5 Outcome: the plan reopened tension with the January Q3 baseline decision.",
        ],
    },
    {
        "title": "Engineering Launch Meeting Notes 2026-04-08",
        "filename": "engineering-launch-meeting-notes-2026-04-08.md",
        "mime_type": "text/markdown",
        "format": "markdown",
        "text": """# Engineering Launch Meeting Notes\nDate: 2026-04-08\n\n## Decisions\n- Decision: we decided to keep the self-serve launch decision gate open until security and activation instrumentation evidence can be compared.\n- Decision: release-control checks will block launch if rollback ownership is unclear.\n\n## Assumptions\n- Assumption: the late-Q2 launch could still work if activation events reach 95 percent coverage by 2026-04-12.\n\n## Constraints\n- Constraint: security review must approve data-retention controls before launch.\n- Constraint: support staffing cannot absorb more than 25 beta escalations per week.\n\n## Commitments\n- Engineering lead will publish the rollback-owner matrix by 2026-04-11.\n- Product operations will prepare the final readiness memo by 2026-04-12.\n""",
    },
    {
        "title": "Customer Success Rollout Meeting Notes",
        "filename": "customer-success-rollout-meeting-notes.md",
        "mime_type": "text/markdown",
        "format": "markdown",
        "text": """# Customer Success Rollout Meeting Notes\nDate: 2026-04-09\n\n## Decisions\n- Decision: customer success chose to keep enterprise onboarding white-glove for accounts above 500 employees until the self-serve launch is reviewed.\n\n## Assumptions\n- Assumption: support can handle a controlled beta if weekly escalations stay below 25.\n\n## Outcomes\n- Outcome: customer success reported that manual onboarding reached 68 accounts and reduced launch pressure for the smallest customers.\n\n## Commitments\n- Customer success lead will update beta account segmentation by 2026-04-13.\n""",
    },
    {
        "title": "Internal Chat Export - Self Serve Launch",
        "filename": "internal-chat-export-self-serve-launch.md",
        "mime_type": "text/markdown",
        "format": "markdown",
        "text": """# Internal Chat Export - Self Serve Launch\nDate: 2026-04-10\n\n[09:12] Maya (Product): Decision: we should treat the launch as controlled beta until security signs off.\n[09:15] Deniz (Engineering): Constraint: release controls must include named rollback owner and dashboard coverage before launch.\n[09:21] Leyla (Customer Success): Assumption: if beta escalations exceed 25 per week, we should pause new accounts.\n[09:30] Omar (Operations): Commitment: operations will compile the go/no-go packet by 2026-04-12.\n[09:35] Maya (Product): Outcome: this chat confirms the late-Q2 plan depends on readiness evidence, not just sales pressure.\n""",
    },
]


def _pdf_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _minimal_pdf_bytes(title: str, lines: list[str]) -> bytes:
    wrapped_lines: list[str] = []
    for line in lines:
        wrapped_lines.extend(textwrap.wrap(line, width=92) or [""])
    commands = ["BT", "/F1 10 Tf", "13 TL", "72 760 Td"]
    for index, line in enumerate(wrapped_lines[:50]):
        if index:
            commands.append("T*")
        commands.append(f"({_pdf_escape(line)}) Tj")
    commands.append("ET")
    stream = "\n".join(commands).encode("utf-8")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    pdf = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets: list[int] = [0]
    for object_number, payload in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf.extend(f"{object_number} 0 obj\n".encode("ascii"))
        pdf.extend(payload)
        pdf.extend(b"\nendobj\n")
    xref_offset = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    pdf.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    pdf.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R /Info << /Title ({_pdf_escape(title)}) >> >>\nstartxref\n{xref_offset}\n%%EOF\n".encode("utf-8")
    )
    return bytes(pdf)


def _seed_demo_users(db: Session, workspace: Workspace) -> dict[str, User]:
    users_by_email: dict[str, User] = {}
    for spec in DEMO_USERS:
        user = db.scalar(select(User).where(User.email == spec["email"]))
        if user is None:
            user = User(
                workspace_id=workspace.workspace_id,
                role=spec["role"],
                display_name=spec["display_name"],
                email=spec["email"],
                password_hash=hash_password(spec["password"]),
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            log_event(
                db,
                workspace_id=workspace.workspace_id,
                actor_user_id=user.user_id,
                event_type="USER_SEEDED",
                target_type="user",
                target_id=user.user_id,
                event_metadata={"role": user.role, "email": user.email, "demo_employee": True},
            )
        else:
            user.role = spec["role"]
            user.display_name = spec["display_name"]
            user.is_active = True
            user.password_hash = hash_password(spec["password"])
            db.commit()
        users_by_email[user.email] = user
    return users_by_email


def _seed_demo_artifacts(db: Session, *, workspace: Workspace, admin: User) -> None:
    from app.services.ingestion import run_ingestion
    from app.services.storage import persist_upload_bytes

    for spec in DEMO_ARTIFACT_SPECS:
        existing = db.scalar(select(Artifact).where(Artifact.workspace_id == workspace.workspace_id, Artifact.title == spec["title"]))
        if existing is not None:
            continue
        artifact = Artifact(
            workspace_id=workspace.workspace_id,
            title=spec["title"],
            source_type="file_upload",
            source_path="pending",
            mime_type=spec["mime_type"],
            uploaded_by=admin.user_id,
            visibility_scope="workspace",
            original_filename=spec["filename"],
            ingestion_status="pending",
            review_status="submitted",
        )
        db.add(artifact)
        db.commit()
        db.refresh(artifact)
        content = _minimal_pdf_bytes(spec["title"], spec["lines"]) if spec["format"] == "pdf" else spec["text"].encode("utf-8")
        source_path, checksum = persist_upload_bytes(content, artifact_id=artifact.artifact_id, filename=spec["filename"])
        artifact.source_path = source_path
        artifact.checksum_sha256 = checksum
        db.commit()
        try:
            run_ingestion(db, artifact=artifact, actor=admin)
            artifact.review_status = "reviewed"
            artifact.reviewed_by = admin.user_id
            artifact.reviewed_at = datetime.utcnow()
            artifact.review_notes = "Seeded company demo artifact reviewed during bootstrap."
            db.commit()
        except Exception as exc:
            artifact.review_status = "needs_review"
            artifact.review_notes = f"Seeded demo artifact needs manual review because ingestion failed: {exc}"
            db.commit()


def _seed_demo_team_chat(db: Session, *, workspace: Workspace, users_by_email: dict[str, User], admin: User) -> None:
    existing = db.scalar(select(CompanyChatMessage).where(CompanyChatMessage.workspace_id == workspace.workspace_id))
    if existing is not None:
        return
    seeded_turns = [
        (users_by_email.get("employee@example.com") or admin, "I uploaded the customer success rollout notes. Can someone verify whether the beta escalation threshold is still 25 per week?"),
        (users_by_email.get("ops@example.com") or admin, "Yes. The go/no-go packet still uses 25 beta escalations per week as the pause threshold, and Izge should cite the CS notes plus launch meeting notes."),
        (admin, "I reviewed the seeded strategy report, roadmap deck, meeting notes, and internal chat export. Employees should use the assistant for evidence-backed answers and this team chat for coordination."),
    ]
    for author, body in seeded_turns:
        db.add(
            CompanyChatMessage(
                workspace_id=workspace.workspace_id,
                author_user_id=author.user_id,
                body=body,
                message_metadata={"channel": "company-general", "seeded": True},
            )
        )
    db.commit()


def initialize_database() -> None:
    settings = get_settings()
    settings.storage_path.mkdir(parents=True, exist_ok=True)
    settings.pasted_storage_path.mkdir(parents=True, exist_ok=True)
    settings.storage_path.parent.mkdir(parents=True, exist_ok=True)

    from app.migration_tools import upgrade_database

    upgrade_database()
    with engine.begin() as connection:
        assert_required_schema_ready(connection)


def _bootstrap_admin_password() -> str:
    settings = get_settings()
    if settings.default_admin_password:
        return settings.default_admin_password
    credentials_file = settings.bootstrap_admin_credentials_file
    credentials_file.parent.mkdir(parents=True, exist_ok=True)
    if credentials_file.exists():
        payload = json.loads(credentials_file.read_text(encoding="utf-8"))
        password = payload.get("password")
        if password:
            return password
    password = secrets.token_urlsafe(18)
    credentials_file.write_text(
        json.dumps({"email": settings.default_admin_email, "password": password}, indent=2),
        encoding="utf-8",
    )
    return password


def seed_defaults(db: Session) -> None:
    settings = get_settings()
    workspace = db.scalar(select(Workspace))
    if workspace is None:
        workspace = Workspace(name=settings.workspace_name, description=settings.workspace_description)
        db.add(workspace)
        db.commit()
        db.refresh(workspace)

    admin = db.scalar(select(User).where(User.email == settings.default_admin_email))
    if admin is None:
        admin = User(
            workspace_id=workspace.workspace_id,
            role="Admin",
            display_name=settings.default_admin_display_name,
            email=settings.default_admin_email,
            password_hash=hash_password(_bootstrap_admin_password()),
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)
        log_event(
            db,
            workspace_id=workspace.workspace_id,
            actor_user_id=admin.user_id,
            event_type="USER_SEEDED",
            target_type="user",
            target_id=admin.user_id,
            event_metadata={"role": admin.role, "email": admin.email},
        )
    elif settings.sync_default_admin_password and settings.default_admin_password:
        admin.password_hash = hash_password(settings.default_admin_password)
        admin.display_name = settings.default_admin_display_name
        admin.is_active = True
        admin.role = "Admin"
        db.commit()
        log_event(
            db,
            workspace_id=workspace.workspace_id,
            actor_user_id=admin.user_id,
            event_type="USER_SEEDED_PASSWORD_SYNCED",
            target_type="user",
            target_id=admin.user_id,
            event_metadata={"role": admin.role, "email": admin.email, "demo_sync": True},
        )


    demo_users = _seed_demo_users(db, workspace)
    _seed_demo_artifacts(db, workspace=workspace, admin=admin)
    _seed_demo_team_chat(db, workspace=workspace, users_by_email=demo_users, admin=admin)
