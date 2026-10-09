from __future__ import annotations

import argparse
from datetime import UTC, datetime
import json
import os
from pathlib import Path
import secrets
import shutil
import sqlite3
import stat
import sys
from zoneinfo import ZoneInfo

from manual_eval.pusula_demo.fixture import (
    ARTIFACTS,
    CHAT_MESSAGES,
    PERSONAS,
    PRELOADED_ROOT,
    SEED_BATCH,
    TASKS,
    WORKSPACE_NAME,
    validate_fixture,
)

REPO_ROOT = Path(__file__).resolve().parents[2]


def _inside(path: Path, parent: Path) -> bool:
    return path == parent or path.is_relative_to(parent)


def _validate_target_paths(
    database: Path,
    storage_root: Path,
    pasted_root: Path,
    credentials_file: Path,
    backup_dir: Path | None,
) -> None:
    home = Path.home().resolve()
    filesystem_root = Path(database.anchor or "/").resolve()
    for directory, label in ((storage_root, "storage"), (pasted_root, "pasted")):
        if directory in {filesystem_root, home, REPO_ROOT} or _inside(home, directory) or _inside(REPO_ROOT, directory):
            raise ValueError(f"Güvensiz {label} hedefi reddedildi: {directory}")
    if _inside(storage_root, pasted_root) or _inside(pasted_root, storage_root):
        raise ValueError("Storage ve pasted hedefleri iç içe olamaz.")
    if _inside(database, storage_root) or _inside(database, pasted_root):
        raise ValueError("Veritabanı silinecek storage/pasted dizininin içinde olamaz.")
    if storage_root == database.parent or pasted_root == database.parent:
        raise ValueError("Storage/pasted hedefi veritabanının ana dizini olamaz.")
    if _inside(credentials_file, storage_root) or _inside(credentials_file, pasted_root):
        raise ValueError("Credentials dosyası silinecek storage/pasted dizininin içinde olamaz.")
    if credentials_file == database:
        raise ValueError("Credentials ve veritabanı aynı dosya olamaz.")
    if backup_dir is not None:
        if _inside(backup_dir, storage_root) or _inside(backup_dir, pasted_root):
            raise ValueError("Yedek dizini silinecek storage/pasted dizininin içinde olamaz.")
        if _inside(storage_root, backup_dir) or _inside(pasted_root, backup_dir):
            raise ValueError("Storage/pasted hedefi yedek dizininin üst dizini olamaz.")


def _backup_existing(database: Path, storage_root: Path, pasted_root: Path, credentials_file: Path, backup_dir: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%dT%H%M%S")
    target = backup_dir / f"pre-{SEED_BATCH}-{stamp}"
    target.mkdir(parents=True, exist_ok=False)
    target.chmod(stat.S_IRWXU)
    if database.exists():
        source_db = sqlite3.connect(database)
        backup_db = sqlite3.connect(target / "izge.db")
        try:
            source_db.backup(backup_db)
        finally:
            backup_db.close()
            source_db.close()
        (target / "izge.db").chmod(stat.S_IRUSR | stat.S_IWUSR)
    for source, name in ((storage_root, "storage"), (pasted_root, "pasted")):
        if source.exists():
            shutil.copytree(source, target / name)
    if credentials_file.exists():
        shutil.copy2(credentials_file, target / "demo-credentials.json")
    return target


def _clear_target(database: Path, storage_root: Path, pasted_root: Path) -> None:
    for path in (database, Path(f"{database}-wal"), Path(f"{database}-shm")):
        path.unlink(missing_ok=True)
    for directory in (storage_root, pasted_root):
        if directory.exists():
            shutil.rmtree(directory)


def _existing_passwords(credentials_file: Path) -> dict[str, str]:
    if not credentials_file.exists():
        return {}
    payload = json.loads(credentials_file.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Credentials dosyası JSON nesnesi olmalıdır.")
    passwords: dict[str, str] = {}
    for persona in PERSONAS:
        nested = payload.get(persona["key"])
        if isinstance(nested, dict) and isinstance(nested.get("password"), str):
            passwords[persona["key"]] = nested["password"]
        elif isinstance(payload.get(persona["email"]), str):
            passwords[persona["key"]] = payload[persona["email"]]
    return passwords


def _write_credentials(credentials_file: Path, passwords: dict[str, str]) -> None:
    credentials_file.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        persona["key"]: {"email": persona["email"], "password": passwords[persona["key"]]}
        for persona in PERSONAS
    }
    credentials_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    credentials_file.chmod(stat.S_IRUSR | stat.S_IWUSR)


def _configure_environment(database: Path, storage_root: Path, pasted_root: Path, credentials_file: Path) -> None:
    os.environ["IZGE_SQLITE_PATH"] = str(database)
    os.environ["IZGE_STORAGE_ROOT"] = str(storage_root)
    os.environ["IZGE_PASTED_TEXT_ROOT"] = str(pasted_root)
    os.environ["IZGE_BOOTSTRAP_ADMIN_CREDENTIALS_PATH"] = str(credentials_file.parent / "unused-bootstrap-admin.json")
    os.environ["IZGE_DEMO_SEED_ENABLED"] = "false"


def _seed(*, run_baseline_detection: bool) -> dict[str, int | str]:
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import Artifact, Automation, CompanyChatMessage, User, WorkTask, Workspace
    from app.services.bootstrap import initialize_database
    from app.services.colleague import ensure_colleague_user
    from app.services.ingestion import run_ingestion
    from app.services.security import hash_password
    from app.services.storage import persist_upload_bytes
    from app.services.temporal_graph import sync_temporal_claims

    initialize_database()
    credentials_file = Path(os.environ["PUSULA_CREDENTIALS_FILE"])
    passwords = _existing_passwords(credentials_file)
    for persona in PERSONAS:
        passwords.setdefault(persona["key"], secrets.token_urlsafe(18))
    _write_credentials(credentials_file, passwords)

    with SessionLocal() as db:
        workspace = Workspace(
            name=WORKSPACE_NAME,
            description="B2B yazılım geliştirme ve IT danışmanlık şirketi demo çalışma alanı",
        )
        db.add(workspace)
        db.flush()

        users: dict[str, User] = {}
        for persona in PERSONAS:
            user = User(
                workspace_id=workspace.workspace_id,
                role=persona["role"],
                display_name=persona["display_name"],
                email=persona["email"],
                password_hash=hash_password(passwords[persona["key"]]),
            )
            db.add(user)
            db.flush()
            users[persona["key"]] = user
        ensure_colleague_user(db, workspace.workspace_id)
        db.commit()

        artifacts: dict[str, Artifact] = {}
        notification_count = 0
        artifact_specs = sorted(ARTIFACTS, key=lambda spec: (spec[0] not in {"atlas_requests", "atlas_tickets"}, spec[2]))
        for key, title, filename, cases in artifact_specs:
            artifact = Artifact(
                workspace_id=workspace.workspace_id,
                title=title,
                source_type="file_upload",
                source_path="pending",
                mime_type="text/markdown",
                uploaded_by=users["ece"].user_id,
                visibility_scope="workspace",
                original_filename=filename,
                ingestion_status="pending",
                review_status="submitted",
            )
            db.add(artifact)
            db.flush()
            source_path, checksum = persist_upload_bytes(
                (PRELOADED_ROOT / filename).read_bytes(),
                artifact_id=artifact.artifact_id,
                filename=filename,
            )
            artifact.source_path = source_path
            artifact.checksum_sha256 = checksum
            db.commit()
            run_ingestion(db, artifact=artifact, actor=users["ece"], use_local_llm=False, use_signal_explanations=False)
            artifact.review_status = "reviewed"
            artifact.reviewed_by = users["selin"].user_id
            artifact.reviewed_at = datetime.now(UTC).replace(tzinfo=None)
            artifact.review_notes = f"{SEED_BATCH}; use-case={','.join(map(str, sorted(cases)))}"
            db.commit()
            artifacts[key] = artifact

            if run_baseline_detection and key == "atlas_tickets":
                from app.models import Notification
                from app.services.colleague import claim_next_colleague_run, enqueue_artifact_review, process_colleague_run

                requested = enqueue_artifact_review(db, artifact=artifacts["atlas_requests"], actor=users["deniz"])
                requested.question = (
                    "Yalnız şu durumu değerlendir: Atlas'ın 18 Eylül tarihli kalıcı sevkiyat listesi indirme talebine müşteriye ‘hallederiz’ denmiş. "
                    "Bu özelliğin ticket'ı, sorumlusu veya teslim tarihi var mı? Kayıtsız kaldıysa bunu sabah Deniz'e bildir; "
                    "diğer ticari ve teknik riskleri bu değerlendirmeye dahil etme."
                )
                requested.context_artifact_ids = [artifacts["atlas_requests"].artifact_id, artifacts["atlas_tickets"].artifact_id]
                requested.thread_title = "İzge · Atlas'ta kayıtsız talep"
                db.commit()
                claimed = claim_next_colleague_run(db, worker_id="pusula-seed")
                if claimed is None or claimed.run_id != requested.run_id:
                    raise RuntimeError("Başlangıç tespit çalışması kuyruğa alındı ancak sahiplenilemedi.")
                completed = process_colleague_run(db, claimed, lease_owner=claimed.lease_owner)
                if completed.status != "completed":
                    raise RuntimeError(f"Başlangıç tespiti tamamlanamadı: {completed.error or completed.status}")
                notification_count = len(
                    db.scalars(
                        select(Notification).where(
                            Notification.workspace_id == workspace.workspace_id,
                            Notification.recipient_user_id == users["deniz"].user_id,
                            Notification.read_at.is_(None),
                        )
                    ).all()
                )
                if notification_count == 0:
                    raise RuntimeError("Gerçek LLM çalışması bildirim üretmedi; başlangıç bildirimi taklit edilmedi.")

        for created_at, author_key, body, metadata_template in CHAT_MESSAGES:
            participant_ids = [users[key].user_id for key in metadata_template["participant_keys"]]
            metadata = {key: value for key, value in metadata_template.items() if key != "participant_keys"}
            metadata.update(
                {
                    "participant_user_ids": participant_ids,
                    "author_title": next(persona["title"] for persona in PERSONAS if persona["key"] == author_key),
                }
            )
            db.add(
                CompanyChatMessage(
                    workspace_id=workspace.workspace_id,
                    author_user_id=users[author_key].user_id,
                    body=body,
                    message_metadata=metadata,
                    created_at=created_at.replace(tzinfo=ZoneInfo("Europe/Istanbul")).astimezone(UTC).replace(tzinfo=None),
                )
            )

        for task_spec in TASKS:
            source_ids = [artifacts[key].artifact_id for key in task_spec["sources"]]
            snapshot = {
                artifact_id: {"title": db.get(Artifact, artifact_id).title, "captured_at": datetime.now(UTC).isoformat()}
                for artifact_id in source_ids
            }
            db.add(
                WorkTask(
                    workspace_id=workspace.workspace_id,
                    created_by=users["ece"].user_id,
                    assignee_user_id=users[task_spec["assignee"]].user_id if task_spec["assignee"] else None,
                    title=task_spec["title"],
                    description=task_spec["description"],
                    status=task_spec["status"],
                    due_at=task_spec["due_at"].replace(tzinfo=ZoneInfo("Europe/Istanbul")).astimezone(UTC).replace(tzinfo=None),
                    source_artifact_ids=source_ids,
                    source_snapshot=snapshot,
                )
            )
        db.commit()
        automations = (
            Automation(
                workspace_id=workspace.workspace_id,
                created_by=users["deniz"].user_id,
                title="Günlük şirket özeti",
                prompt=(
                    "Bugün eklenen kayıtları, açık işleri ve müşteri konuşmalarını gözden geçir. Faturalanmamış işleri, "
                    "sahipsiz müşteri taleplerini, müşteri kaybı risklerini, tekrarlayan sorunları ve ekipler arası bekleyen "
                    "işleri kaynaklarıyla kısa bir günlük özet halinde hazırla."
                ),
                schedule_time="16:00",
                enabled=True,
            ),
            Automation(
                workspace_id=workspace.workspace_id,
                created_by=users["ece"].user_id,
                title="Kayıtsız müşteri taleplerini kontrol et",
                prompt=(
                    "Müşteri yazışmalarındaki söz verilmiş özellik ve düzeltme taleplerini açık görevlerle karşılaştır. "
                    "Ticket'ı, sorumlusu veya teslim tarihi olmayan talepleri ve önerilen sonraki adımı kaynaklarıyla bildir."
                ),
                schedule_time="09:00",
                enabled=True,
            ),
            Automation(
                workspace_id=workspace.workspace_id,
                created_by=users["ece"].user_id,
                title="Koru teklif paketini kontrol et",
                prompt=(
                    "Koru ihalesinin en güncel şartname ve zeyilnamelerindeki zorunlu belgeleri teklif paketi kontrol "
                    "listesiyle karşılaştır. Eksik belge varsa sorumlu ve son tarihle kaynaklı olarak bildir."
                ),
                schedule_time="15:00",
                enabled=True,
            ),
        )
        db.add_all(automations)
        db.commit()
        sync_temporal_claims(db, workspace_id=workspace.workspace_id)
        db.commit()

        return {
            "workspace_id": workspace.workspace_id,
            "users": len(users),
            "artifacts": len(artifacts),
            "messages": len(CHAT_MESSAGES),
            "tasks": len(TASKS),
            "automations": len(automations),
            "unread_notifications": notification_count,
        }


def main() -> None:
    parser = argparse.ArgumentParser(description="Pusula B2B demo verisini güvenli ve tekrarlanabilir biçimde oluşturur.")
    parser.add_argument("--database", type=Path)
    parser.add_argument("--storage-root", type=Path)
    parser.add_argument("--pasted-root", type=Path)
    parser.add_argument("--credentials-file", type=Path)
    parser.add_argument("--backup-dir", type=Path)
    parser.add_argument("--replace", action="store_true", help="Mevcut hedefi yedekledikten sonra sıfırdan oluştur.")
    parser.add_argument("--run-baseline-detection", action="store_true", help="#2 için gerçek yerel LLM değerlendirmesini çalıştır.")
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()

    validate_fixture()
    if args.check_only:
        print("Pusula fixture kontrolü geçti: 6 use case, 10 seed kaynağı, 2 ayrı canlı yükleme dosyası.")
        return

    missing = [name for name in ("database", "storage_root", "pasted_root", "credentials_file") if getattr(args, name) is None]
    if missing:
        parser.error("Seed için zorunlu hedefler eksik: " + ", ".join(f"--{name.replace('_', '-')}" for name in missing))

    database = args.database.expanduser().resolve()
    storage_root = args.storage_root.expanduser().resolve()
    pasted_root = args.pasted_root.expanduser().resolve()
    credentials_file = args.credentials_file.expanduser().resolve()
    backup_dir = args.backup_dir.expanduser().resolve() if args.backup_dir else None
    _validate_target_paths(database, storage_root, pasted_root, credentials_file, backup_dir)
    has_existing_target = database.exists() or storage_root.exists() or pasted_root.exists()
    if has_existing_target and not args.replace:
        parser.error("Hedefte veri var. Değiştirmek için --replace ve --backup-dir birlikte verilmelidir.")
    if args.replace and args.backup_dir is None:
        parser.error("--replace kullanıldığında --backup-dir zorunludur.")

    backup_path: Path | None = None
    if has_existing_target:
        assert backup_dir is not None
        backup_path = _backup_existing(database, storage_root, pasted_root, credentials_file, backup_dir)
        _clear_target(database, storage_root, pasted_root)
    database.parent.mkdir(parents=True, exist_ok=True)
    os.environ["PUSULA_CREDENTIALS_FILE"] = str(credentials_file)
    _configure_environment(database, storage_root, pasted_root, credentials_file)
    result = _seed(run_baseline_detection=args.run_baseline_detection)
    print(
        "Pusula demo seed tamamlandı: "
        f"workspace={result['workspace_id']} kullanıcı={result['users']} kaynak={result['artifacts']} "
        f"mesaj={result['messages']} iş={result['tasks']} otomasyon={result['automations']} "
        f"okunmamış_bildirim={result['unread_notifications']}."
    )
    print(f"Credentials güncellendi: {credentials_file} (parolalar terminale yazılmadı).")
    if backup_path is not None:
        print(f"Önceki hedef yedeklendi: {backup_path}")


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, ValueError, RuntimeError) as exc:
        print(f"Pusula demo seed başarısız: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
