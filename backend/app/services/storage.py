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


def managed_source_roots() -> tuple[Path, Path]:
    settings = get_settings()
    return settings.storage_path.resolve(strict=False), settings.pasted_storage_path.resolve(strict=False)


def artifact_source_candidates(*, source_path: str, artifact_id: str, source_type: str) -> list[Path]:
    """Return current-env candidates for a stored artifact source path.

    Existing development databases can contain absolute paths from a previous
    host runtime, while Docker sees the same mounted files at `/data/...`.
    Keep the database stable and resolve such records to the current configured
    storage roots when the artifact-id subpath still exists.
    """

    if not source_path or source_path == "pending":
        return []

    settings = get_settings()
    raw_path = Path(source_path).expanduser()
    candidates = [raw_path]
    raw_parts = raw_path.parts

    for root_name, current_root in (("storage", settings.storage_path), ("pasted", settings.pasted_storage_path)):
        matching_indexes = [index for index, part in enumerate(raw_parts) if part == root_name]
        for index in reversed(matching_indexes):
            tail = raw_parts[index + 1 :]
            if tail and tail[0] == artifact_id:
                candidates.append(current_root.joinpath(*tail))
                break

    unique: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate)
        if key not in seen:
            seen.add(key)
            unique.append(candidate)
    return unique


def resolve_artifact_source_path(*, source_path: str, artifact_id: str, source_type: str) -> Path | None:
    allowed_roots = managed_source_roots()
    for candidate in artifact_source_candidates(source_path=source_path, artifact_id=artifact_id, source_type=source_type):
        try:
            resolved = candidate.resolve(strict=True)
        except FileNotFoundError:
            continue
        if not resolved.is_file():
            continue
        if any(resolved.is_relative_to(root) for root in allowed_roots):
            return resolved
    return None
