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


DEFAULT_EMPLOYEE_1_PASSWORD = "change-me-employee1"
DEFAULT_EMPLOYEE_2_PASSWORD = "change-me-employee2"
DEFAULT_EMPLOYEE_3_PASSWORD = "change-me-employee3"

DEFAULT_EMPLOYEE_USERS = [
    {
        "display_name": "Employee 1",
        "email": "employee1@example.com",
        "password": DEFAULT_EMPLOYEE_1_PASSWORD,
        "role": "Member",
    },
    {
        "display_name": "Employee 2",
        "email": "employee2@example.com",
        "password": DEFAULT_EMPLOYEE_2_PASSWORD,
        "role": "Member",
    },
    {
        "display_name": "Employee 3",
        "email": "employee3@example.com",
        "password": DEFAULT_EMPLOYEE_3_PASSWORD,
        "role": "Member",
    },
]

DEFAULT_ARTIFACT_SPECS = [
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
    {
        "title": "April Finance and Hiring Budget Memo",
        "filename": "april-finance-hiring-budget-memo.pdf",
        "mime_type": "application/pdf",
        "format": "pdf",
        "lines": [
            "April Finance and Hiring Budget Memo",
            "Date: 2026-04-03",
            "Decision: finance approved two customer-success backfill hires and paused one growth-marketing contractor until May.",
            "Assumption: support volume will stay below 210 tickets per week if beta onboarding remains controlled.",
            "Constraint: the Q2 hiring budget cannot exceed 118000 USD without CFO approval.",
            "Commitment: People Operations will post the customer-success roles by 2026-04-15.",
            "Outcome: engineering hiring is unchanged, but the support coverage plan must be reviewed weekly.",
        ],
    },
    {
        "title": "Security Access Review - April 2026",
        "filename": "security-access-review-april-2026.md",
        "mime_type": "text/markdown",
        "format": "markdown",
        "text": """# Security Access Review - April 2026\nDate: 2026-04-05\n\n## Decisions\n- Decision: contractors keep read-only analytics access; payroll export access is limited to finance admins.\n- Decision: dormant sandbox tokens older than 30 days will be revoked each Friday.\n\n## Constraints\n- Constraint: payroll exports cannot be attached to team chat or shared channels.\n- Constraint: customer PII review must happen before any broad self-serve beta expansion.\n\n## Commitments\n- Security will publish the token revocation report by 2026-04-12.\n- Finance will confirm the payroll-export admin list by 2026-04-09.\n""",
    },
    {
        "title": "Customer Support Escalation Digest - Week 15",
        "filename": "customer-support-escalation-digest-week-15.md",
        "mime_type": "text/markdown",
        "format": "markdown",
        "text": """# Customer Support Escalation Digest - Week 15\nDate: 2026-04-11\n\n## Outcomes\n- Outcome: 17 beta onboarding escalations were logged this week; 4 were payroll import issues.\n- Outcome: two enterprise customers asked for clearer admin permission copy during setup.\n\n## Assumptions\n- Assumption: weekly beta escalations below 25 remain manageable with the current support rota.\n\n## Commitments\n- Support will send the payroll import FAQ to product by 2026-04-14.\n- Employee 2 will check whether the permission-copy request overlaps with the security access review.\n""",
    },
    {
        "title": "Engineering Incident Retrospective - Analytics Delay",
        "filename": "engineering-incident-retrospective-analytics-delay.pdf",
        "mime_type": "application/pdf",
        "format": "pdf",
        "lines": [
            "Engineering Incident Retrospective - Analytics Delay",
            "Date: 2026-04-06",
            "Outcome: activation analytics lagged by 42 minutes after the event-index rebuild.",
            "Decision: analytics backfill jobs will run with a release flag and named rollback owner.",
            "Assumption: a 15 minute analytics delay is acceptable for internal monitoring but not for launch readiness scoring.",
            "Constraint: release-control checks must include dashboard freshness and rollback ownership before beta expansion.",
            "Commitment: Engineering will add freshness alerts to the launch dashboard by 2026-04-10.",
        ],
    },
    {
        "title": "Office Ops PTO and Coverage Note",
        "filename": "office-ops-pto-coverage-note.md",
        "mime_type": "text/markdown",
        "format": "markdown",
        "text": """# Office Ops PTO and Coverage Note\nDate: 2026-04-07\n\n## Decisions\n- Decision: employee PTO coverage will be tracked in the shared operations calendar only, not in ad-hoc chat threads.\n\n## Constraints\n- Constraint: finance approval is required before temporary weekend support coverage is booked.\n\n## Commitments\n- Operations will update the shared coverage calendar every Monday morning.\n- Employee 3 will remind the team to keep urgent customer handoffs inside Team Chat direct conversations.\n""",
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


def _seed_default_users(db: Session, workspace: Workspace) -> dict[str, User]:
    users_by_email: dict[str, User] = {}
    for spec in DEFAULT_EMPLOYEE_USERS:
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
                event_metadata={"role": user.role, "email": user.email, "seeded_employee": True},
            )
        else:
            user.role = spec["role"]
            user.display_name = spec["display_name"]
            user.is_active = True
            user.password_hash = hash_password(spec["password"])
            db.commit()
        users_by_email[user.email] = user
    return users_by_email


def _seed_default_artifacts(db: Session, *, workspace: Workspace, admin: User) -> None:
    from app.services.ingestion import run_ingestion
    from app.services.storage import persist_upload_bytes

    settings = get_settings()
    for spec in DEFAULT_ARTIFACT_SPECS:
        existing = db.scalar(select(Artifact).where(Artifact.workspace_id == workspace.workspace_id, Artifact.title == spec["title"]))
        if existing is not None:
            if existing.ingestion_status == "completed" and existing.review_status in {"submitted", "needs_review"}:
                existing.review_status = "reviewed"
                existing.reviewed_by = admin.user_id
                existing.reviewed_at = datetime.utcnow()
                existing.review_notes = "Seeded company artifact reviewed during bootstrap."
                db.commit()
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
        previous_local_llm_enabled = settings.local_llm_enabled
        previous_signal_explanation_enabled = settings.llm_signal_explanation_enabled
        settings.local_llm_enabled = False
        settings.llm_signal_explanation_enabled = False
        try:
            run_ingestion(db, artifact=artifact, actor=admin)
            artifact.review_status = "reviewed"
            artifact.reviewed_by = admin.user_id
            artifact.reviewed_at = datetime.utcnow()
            artifact.review_notes = "Seeded company artifact reviewed during bootstrap."
            db.commit()
        except Exception as exc:
            artifact.review_status = "needs_review"
            artifact.review_notes = f"Seeded artifact needs manual review because ingestion failed: {exc}"
            db.commit()
        finally:
            settings.local_llm_enabled = previous_local_llm_enabled
            settings.llm_signal_explanation_enabled = previous_signal_explanation_enabled


def _seed_default_team_chat(db: Session, *, workspace: Workspace, users_by_email: dict[str, User], admin: User) -> None:
    def thread_metadata(thread_id: str, thread_title: str, thread_kind: str = "channel") -> dict[str, object]:
        return {
            "channel": thread_id,
            "thread_id": thread_id,
            "thread_title": thread_title,
            "thread_kind": thread_kind,
            "seeded": True,
            "seed_batch": "northstar-workspace-v2",
        }

    seeded_turns = [
        (
            datetime(2026, 4, 8, 9, 5),
            users_by_email.get("employee1@example.com") or admin,
            "Morning — I uploaded the customer-success notes. Can someone confirm whether the beta escalation threshold is still 25 per week?",
            thread_metadata("company-general", "Company General"),
        ),
        (
            datetime(2026, 4, 8, 9, 8),
            users_by_email.get("employee2@example.com") or admin,
            "Confirmed. The go/no-go packet still uses 25 beta escalations per week as the pause threshold.",
            thread_metadata("company-general", "Company General"),
        ),
        (
            datetime(2026, 4, 8, 9, 16),
            admin,
            "I reviewed the strategy report, roadmap deck, meeting notes, and internal chat export. Keep source-specific questions in the assistant and coordination here.",
            thread_metadata("company-general", "Company General"),
        ),
        (
            datetime(2026, 4, 8, 10, 20),
            users_by_email.get("employee2@example.com") or admin,
            "The roadmap deck still targets late Q2, but the April notes keep security and activation instrumentation as the actual gate.",
            thread_metadata("product-rollout", "Product Rollout"),
        ),
        (
            datetime(2026, 4, 8, 10, 28),
            users_by_email.get("employee3@example.com") or admin,
            "I will attach the rollback-owner matrix once engineering signs off. For now the launch dashboard freshness alert is the risky part.",
            thread_metadata("product-rollout", "Product Rollout"),
        ),
        (
            datetime(2026, 4, 9, 13, 2),
            users_by_email.get("employee1@example.com") or admin,
            "Can you review the beta segmentation update before I send it to customer success?",
            thread_metadata("direct:employee1-employee2", "Employee 1 / Employee 2", "direct"),
        ),
        (
            datetime(2026, 4, 9, 13, 7),
            users_by_email.get("employee2@example.com") or admin,
            "Yes. Send it here after the last artifact review finishes. Also add the two permission-copy requests from support.",
            thread_metadata("direct:employee1-employee2", "Employee 1 / Employee 2", "direct"),
        ),
        (
            datetime(2026, 4, 9, 16, 42),
            users_by_email.get("employee1@example.com") or admin,
            "Quick check: are you still covering payroll-import tickets tomorrow morning?",
            thread_metadata("direct:employee1-employee3", "Employee 1 / Employee 3", "direct"),
        ),
        (
            datetime(2026, 4, 9, 16, 44),
            users_by_email.get("employee3@example.com") or admin,
            "Yes. I blocked 09:00-11:00. If anything is PII-sensitive, I will move it to the security review thread instead of attaching it here.",
            thread_metadata("direct:employee1-employee3", "Employee 1 / Employee 3", "direct"),
        ),
        (
            datetime(2026, 4, 9, 16, 49),
            users_by_email.get("employee1@example.com") or admin,
            "Perfect, thanks. Lunch after the payroll queue clears?",
            thread_metadata("direct:employee1-employee3", "Employee 1 / Employee 3", "direct"),
        ),
        (
            datetime(2026, 4, 10, 8, 57),
            users_by_email.get("employee2@example.com") or admin,
            "I saw the finance memo. Are the two customer-success backfill roles already approved or just proposed?",
            thread_metadata("direct:employee2-employee3", "Employee 2 / Employee 3", "direct"),
        ),
        (
            datetime(2026, 4, 10, 9, 1),
            users_by_email.get("employee3@example.com") or admin,
            "Approved. The paused item is the growth-marketing contractor. I will update the coverage note so the assistant stops treating weekend coverage as already booked.",
            thread_metadata("direct:employee2-employee3", "Employee 2 / Employee 3", "direct"),
        ),
        (
            datetime(2026, 4, 10, 9, 4),
            users_by_email.get("employee2@example.com") or admin,
            "Great. I will ask Izge to compare the finance memo with the support digest before I write the onboarding FAQ.",
            thread_metadata("direct:employee2-employee3", "Employee 2 / Employee 3", "direct"),
        ),
        (
            datetime(2026, 4, 10, 15, 22),
            users_by_email.get("employee1@example.com") or admin,
            "The payroll import FAQ draft is in Memory now. Please skim the customer-facing wording before Monday.",
            thread_metadata("customer-success", "Customer Success"),
        ),
        (
            datetime(2026, 4, 10, 15, 31),
            users_by_email.get("employee3@example.com") or admin,
            "Skimmed it. The steps are fine, but we should not mention payroll export admins outside the security access review.",
            thread_metadata("customer-success", "Customer Success"),
        ),
    ]
    for created_at, author, body, metadata in seeded_turns:
        existing = db.scalar(
            select(CompanyChatMessage).where(
                CompanyChatMessage.workspace_id == workspace.workspace_id,
                CompanyChatMessage.author_user_id == author.user_id,
                CompanyChatMessage.body == body,
            )
        )
        if existing is not None:
            continue
        db.add(
            CompanyChatMessage(
                workspace_id=workspace.workspace_id,
                author_user_id=author.user_id,
                body=body,
                message_metadata=metadata,
                created_at=created_at,
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
            event_metadata={"role": admin.role, "email": admin.email, "bootstrap_sync": True},
        )


    default_users = _seed_default_users(db, workspace)
    _seed_default_artifacts(db, workspace=workspace, admin=admin)
    _seed_default_team_chat(db, workspace=workspace, users_by_email=default_users, admin=admin)
