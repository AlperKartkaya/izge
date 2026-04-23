from __future__ import annotations

import hashlib
from pathlib import Path

from fastapi import UploadFile

from app.config import get_settings


SUPPORTED_CONTENT_TYPES = {
    "text/plain",
    "text/markdown",
    "application/pdf",
}
SUPPORTED_EXTENSIONS = {".txt", ".md", ".markdown", ".pdf"}


def ensure_supported_upload(upload: UploadFile) -> None:
    suffix = Path(upload.filename or "").suffix.lower()
    if upload.content_type not in SUPPORTED_CONTENT_TYPES or suffix not in SUPPORTED_EXTENSIONS:
        raise ValueError("Supported file types are Markdown, plain text, and text-extractable PDF")


def persist_upload_bytes(content: bytes, *, artifact_id: str, filename: str | None) -> tuple[str, str]:
    settings = get_settings()
    suffix = Path(filename or "upload.bin").suffix or ".bin"
    target_dir = settings.storage_path / artifact_id
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / f"source{suffix}"
    target_path.write_bytes(content)
    checksum = hashlib.sha256(content).hexdigest()
    return str(target_path), checksum


def persist_pasted_text(text: str, *, artifact_id: str) -> tuple[str, str]:
    settings = get_settings()
    target_dir = settings.pasted_storage_path / artifact_id
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / "pasted.txt"
    encoded = text.encode("utf-8")
    target_path.write_bytes(encoded)
    checksum = hashlib.sha256(encoded).hexdigest()
    return str(target_path), checksum
