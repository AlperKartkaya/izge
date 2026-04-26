from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import re
from typing import Literal

from pydantic import BaseModel, ValidationError, field_validator
from pypdf import PdfReader
from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import (
    Artifact,
    ArtifactChunk,
    Assumption,
    Commitment,
    Constraint,
    Decision,
    GraphEdge,
    GraphNode,
    IngestionJob,
    Outcome,
    User,
)
from app.services import LocalLLMError, run_structured_local_prompt
from app.services.audit import log_event

MEMORY_MODELS = {
    "decision": (Decision, "decision_id"),
    "assumption": (Assumption, "assumption_id"),
    "constraint": (Constraint, "constraint_id"),
    "outcome": (Outcome, "outcome_id"),
    "commitment": (Commitment, "commitment_id"),
}

DATE_PATTERNS = [
    re.compile(r"\b(20\d{2}-\d{2}-\d{2})\b"),
    re.compile(r"\b(20\d{2}/\d{2}/\d{2})\b"),
]
HEADING_PATTERN = re.compile(r"^(#{1,6})\s+(?P<title>.+?)\s*$")
STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "because",
    "by",
    "for",
    "from",
    "if",
    "in",
    "into",
    "is",
    "it",
    "of",
    "on",
    "or",
    "our",
    "that",
    "the",
    "their",
    "this",
    "to",
    "was",
    "we",
    "will",
    "with",
}
MEMORY_TYPE_TERMS = {"decision", "assumption", "constraint", "outcome", "commitment", "decisions", "assumptions", "constraints", "outcomes", "commitments"}

DECISION_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\bwe decided\b",
        r"\bdecision\b",
        r"\bapproved\b",
        r"\bchose\b",
        r"\bprioriti[sz]e\b",
        r"\bdeprioriti[sz]e\b",
        r"\bmove(?:d)? .+? to q[1-4]\b",
        r"\bdelay(?:ed)?\b",
        r"\bpostpone(?:d)?\b",
        r"\breintroduce\b",
        r"\blaunch target\b",
    )
]
ASSUMPTION_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\bassum(?:e|ed|ing)\b",
        r"\bexpected\b",
        r"\bbelieved\b",
        r"\bforecast\b",
        r"\bplanned on\b",
    )
]
CONSTRAINT_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\bmust\b",
        r"\bcannot\b",
        r"\bcan't\b",
        r"\blimited\b",
        r"\brequires\b",
        r"\bblocked by\b",
        r"\bdepends on\b",
        r"\bcapacity\b",
        r"\breview must\b",
    )
]
OUTCOME_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\boutcome\b",
        r"\bresult(?:ed)?\b",
        r"\bled to\b",
        r"\bcaused\b",
        r"\bmissed\b",
        r"\bslipped\b",
        r"\bincreased\b",
        r"\bdecreased\b",
        r"\breached\b",
        r"\blacks?\b",
    )
]
COMMITMENT_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\bwill\b",
        r"\baction item\b",
        r"\bowner\b",
        r"\bby 20\d{2}-\d{2}-\d{2}\b",
        r"\bcommit(?:ment)?\b",
        r"\bfollow up\b",
        r"\bprepare\b",
        r"\bpublish\b",
    )
]
NEGATIVE_OUTCOME_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\bblocked\b",
        r"\bslipped\b",
        r"\bmissed\b",
        r"\blacks?\b",
        r"\bexceeded\b",
        r"\bincreased\b",
        r"\breached\b",
        r"\bdelayed\b",
    )
]
CONTRADICTION_TERMS = {"delay", "delayed", "postpone", "postponed", "q2", "q3", "q4", "advance", "reintroduce", "ship", "launch", "keep", "revert"}


@dataclass(frozen=True)
class TextSegment:
    text: str
    sequence_number: int
    line_start: int
    line_end: int
    section_path: str


@dataclass(frozen=True)
class ExtractionItem:
    memory_type: str
    label: str
    normalized_text: str
    sequence_number: int
    evidence_span: str
    confidence_score: float
    event_timestamp: datetime
    topic_key: str
    extraction_method: str = "heuristic"
    owner_hint: str | None = None
    due_date: datetime | None = None


@dataclass(frozen=True)
class PersistedMemory:
    memory_type: str
    memory_id: str
    node_id: str
    title_or_label: str
    normalized_text: str
    source_artifact_id: str
    source_chunk_id: str | None
    event_timestamp: datetime
    confidence_score: float
    topic_key: str
    extraction_method: str = "heuristic"
    status: str | None = None
    owner_hint: str | None = None
    due_date: datetime | None = None


@dataclass(frozen=True)
class ExtractionDiagnostics:
    extraction_method: str
    fallback_reason: str | None = None


class LLMExtractionObject(BaseModel):
    memory_type: Literal["decision", "assumption", "constraint", "outcome", "commitment"]
    text: str
    evidence_quote: str
    confidence: float
    observed_at: str | None = None
    owner: str | None = None
    due_date: str | None = None

    @field_validator("confidence")
    @classmethod
    def validate_confidence(cls, value: float) -> float:
        if not 0 <= value <= 1:
            raise ValueError("confidence must be between 0 and 1")
        return value

    @field_validator("due_date")
    @classmethod
    def validate_due_date(cls, value: str | None) -> str | None:
        if value is None or _parse_date(value) is not None:
            return value
        raise ValueError("due_date must be YYYY-MM-DD when provided")


class LLMExtractionEnvelope(BaseModel):
    objects: list[LLMExtractionObject] = []


def extract_text_for_artifact(artifact: Artifact) -> str:
    path = Path(artifact.source_path)
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        reader = PdfReader(str(path))
        pages: list[str] = []
        for index, page in enumerate(reader.pages, start=1):
            page_text = page.extract_text(extraction_mode="layout") or page.extract_text() or ""
            if page_text.strip():
                pages.append(f"[Page {index}]\n{page_text.strip()}")
        return "\n\n".join(pages).strip()
    return path.read_text(encoding="utf-8", errors="ignore")


def chunk_text(text: str) -> list[str]:
    settings = get_settings()
    cleaned = "\n".join(line.rstrip() for line in text.splitlines()).strip()
    if not cleaned:
        return []
    chunks: list[str] = []
    start = 0
    step = max(settings.chunk_size - settings.chunk_overlap, 1)
    while start < len(cleaned):
        chunks.append(cleaned[start : start + settings.chunk_size])
        start += step
    return chunks


def _parse_date(raw_value: str) -> datetime | None:
    candidate = raw_value.strip().replace("/", "-")
    try:
        return datetime.strptime(candidate, "%Y-%m-%d")
    except ValueError:
        return None


def _infer_artifact_timestamp(artifact: Artifact, text: str) -> datetime:
    search_window = "\n".join(text.splitlines()[:12])
    for pattern in DATE_PATTERNS:
        match = pattern.search(artifact.title) or pattern.search(search_window)
        if match:
            parsed = _parse_date(match.group(1))
            if parsed is not None:
                return parsed
    return artifact.created_at


def _normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _trim_label(value: str) -> str:
    normalized = _normalize_whitespace(value)
    normalized = re.sub(r"^(we decided to|decision:?|assumption:?|constraint:?|outcome:?|commitment:?|we assumed that|we assumed)\s+", "", normalized, flags=re.IGNORECASE)
    return normalized[:255].rstrip(" .")


def _topic_tokens(value: str) -> list[str]:
    tokens = re.findall(r"[a-z0-9]+", value.lower())
    return [token for token in tokens if token not in STOPWORDS and token not in MEMORY_TYPE_TERMS and len(token) > 2]


def _topic_key(value: str) -> str:
    tokens = _topic_tokens(value)
    if not tokens:
        return "general"
    filtered = [token for token in tokens if token not in {"late", "early", "current", "revised", "target", "plan", "launch", "q1", "q2", "q3", "q4", "2026"}]
    if filtered:
        tokens = filtered
    return " ".join(tokens[:5])


def _token_overlap(left: str, right: str) -> int:
    return len(set(_topic_tokens(left)) & set(_topic_tokens(right)))


def _clean_sentence_for_extraction(text: str) -> str:
    normalized = _normalize_whitespace(text)
    normalized = normalized.lstrip("-•* ")
    return normalized


def _split_sentences(value: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+|\n+", value)
    return [_clean_sentence_for_extraction(part) for part in parts if _clean_sentence_for_extraction(part)]


def _build_segments(text: str) -> list[TextSegment]:
    lines = text.splitlines()
    sections: list[tuple[int, str]] = [(1, "Document")]
    for index, line in enumerate(lines, start=1):
        heading_match = HEADING_PATTERN.match(line.strip())
        if heading_match:
            sections.append((index, heading_match.group("title").strip()))

    def section_for_line(line_number: int) -> str:
        active = "Document"
        for section_line, title in sections:
            if section_line <= line_number:
                active = title
            else:
                break
        return active

    segments: list[TextSegment] = []
    for index, line in enumerate(lines, start=1):
        stripped = line.strip()
        if not stripped or HEADING_PATTERN.match(stripped):
            continue
        section_path = section_for_line(index)
        for sentence in _split_sentences(stripped):
            segments.append(
                TextSegment(
                    text=sentence,
                    sequence_number=0,
                    line_start=index,
                    line_end=index,
                    section_path=section_path,
                )
            )
    return segments


def _segment_sequence_map(chunks: list[str]) -> dict[str, int]:
    mapping: dict[str, int] = {}
    for index, chunk in enumerate(chunks, start=1):
        for line in chunk.splitlines():
            normalized = _normalize_whitespace(line)
            if normalized and normalized not in mapping:
                mapping[normalized] = index
    return mapping


def _infer_memory_type(text: str, section_path: str) -> tuple[str | None, float]:
    lowered_section = section_path.lower()
    for label in MEMORY_MODELS:
        if label in lowered_section or f"{label}s" in lowered_section:
            return label, 0.92

    detectors = [
        ("decision", DECISION_PATTERNS),
        ("assumption", ASSUMPTION_PATTERNS),
        ("constraint", CONSTRAINT_PATTERNS),
        ("outcome", OUTCOME_PATTERNS),
        ("commitment", COMMITMENT_PATTERNS),
    ]
    scores: list[tuple[str, float]] = []
    for label, patterns in detectors:
        score = 0.0
        for pattern in patterns:
            if pattern.search(text):
                score += 0.28
        if label == "commitment" and re.search(r"\bby\s+20\d{2}-\d{2}-\d{2}\b", text, re.IGNORECASE):
            score += 0.18
        if score > 0:
            scores.append((label, min(score + 0.32, 0.86)))
    if not scores:
        return None, 0.0
    scores.sort(key=lambda item: item[1], reverse=True)
    return scores[0]


def _extract_owner_hint(text: str) -> str | None:
    owner_match = re.match(r"(?P<owner>.+?)\s+will\b", text)
    if owner_match:
        owner = _normalize_whitespace(owner_match.group("owner"))
        if owner and owner.lower() not in {"we", "team", "leadership"} and len(owner) <= 80:
            return owner
    return None


def _extract_due_date_hint(text: str) -> datetime | None:
    due_date_match = re.search(r"\bby\s+(20\d{2}[-/]\d{2}[-/]\d{2})\b", text, re.IGNORECASE)
    if due_date_match:
        return _parse_date(due_date_match.group(1))
    return None


def _extract_segment_timestamp(segment_text: str, fallback: datetime) -> datetime:
    for pattern in DATE_PATTERNS:
        match = pattern.search(segment_text)
        if match:
            parsed = _parse_date(match.group(1))
            if parsed is not None:
                return parsed
    return fallback


def _llm_system_prompt() -> str:
    return (
        "Extract institutional memory objects from one artifact chunk. "
        "Return JSON only, matching the provided schema exactly. "
        "Allowed memory_type values are decision, assumption, constraint, outcome, and commitment. "
        "Only emit objects directly supported by the chunk text. "
        "Each object must include an evidence_quote copied from the chunk. "
        "For commitments, include owner and due_date only when the chunk states them explicitly. "
        "Do not invent evidence or summarize the entire chunk."
    )


def _llm_user_prompt(*, artifact_title: str, chunk_sequence: int, chunk_text: str, artifact_timestamp: datetime) -> str:
    return (
        f"Artifact title: {artifact_title}\n"
        f"Chunk sequence: {chunk_sequence}\n"
        f"Artifact observed_at fallback: {artifact_timestamp.strftime('%Y-%m-%d')}\n\n"
        "Extract memory-worthy claims from this chunk. If nothing qualifies, return {\"objects\": []}. "
        "Use observed_at only when the chunk explicitly states a concrete YYYY-MM-DD date; otherwise leave it null.\n\n"
        f"Chunk text:\n{chunk_text}"
    )


def _extract_memory_candidates_with_local_llm(chunks: list[str], artifact: Artifact, artifact_text: str) -> list[ExtractionItem]:
    artifact_timestamp = _infer_artifact_timestamp(artifact, artifact_text)
    schema = LLMExtractionEnvelope.model_json_schema()
    items: list[ExtractionItem] = []
    seen_keys: set[tuple[str, str, int]] = set()

    for sequence_number, chunk_text_value in enumerate(chunks, start=1):
        parsed = run_structured_local_prompt(
            system_prompt=_llm_system_prompt(),
            user_prompt=_llm_user_prompt(
                artifact_title=artifact.title,
                chunk_sequence=sequence_number,
                chunk_text=chunk_text_value,
                artifact_timestamp=artifact_timestamp,
            ),
            schema=schema,
        )
        envelope = LLMExtractionEnvelope.model_validate(parsed)
        for obj in envelope.objects:
            normalized_text = _normalize_whitespace(obj.text)
            if not normalized_text:
                continue
            evidence_quote = _normalize_whitespace(obj.evidence_quote) or normalized_text
            topic_key = _topic_key(normalized_text)
            dedupe_key = (obj.memory_type, topic_key, sequence_number)
            if dedupe_key in seen_keys:
                continue
            seen_keys.add(dedupe_key)
            observed_at = _parse_date(obj.observed_at) if obj.observed_at else None
            items.append(
                ExtractionItem(
                    memory_type=obj.memory_type,
                    label=_trim_label(normalized_text),
                    normalized_text=normalized_text,
                    sequence_number=sequence_number,
                    evidence_span=f"chunk {sequence_number}: {evidence_quote[:220]}",
                    confidence_score=round(obj.confidence, 2),
                    event_timestamp=observed_at or artifact_timestamp,
                    topic_key=topic_key,
                    extraction_method="local_llm",
                    owner_hint=(obj.owner and _normalize_whitespace(obj.owner)) or (_extract_owner_hint(normalized_text) if obj.memory_type == "commitment" else None),
                    due_date=_parse_date(obj.due_date) if obj.due_date else (_extract_due_date_hint(normalized_text) if obj.memory_type == "commitment" else None),
                )
            )

    return items


def extract_memory_candidates(chunks: list[str], artifact: Artifact, artifact_text: str) -> tuple[list[ExtractionItem], ExtractionDiagnostics]:
    settings = get_settings()
    if settings.local_llm_enabled:
        fallback_reason: str | None = None
        try:
            llm_items = _extract_memory_candidates_with_local_llm(chunks, artifact, artifact_text)
            if llm_items:
                return llm_items, ExtractionDiagnostics(extraction_method="local_llm")
            fallback_reason = "Local LLM returned no extractable memory objects; falling back to heuristic extraction."
        except (LocalLLMError, ValidationError) as exc:
            fallback_reason = str(exc)

    sequence_map = _segment_sequence_map(chunks)
    artifact_timestamp = _infer_artifact_timestamp(artifact, artifact_text)
    items: list[ExtractionItem] = []
    seen_keys: set[tuple[str, str, int]] = set()

    for segment in _build_segments(artifact_text):
        memory_type, confidence = _infer_memory_type(segment.text, segment.section_path)
        if memory_type is None:
            continue
        sequence_number = sequence_map.get(segment.text)
        if sequence_number is None:
            for candidate_line, candidate_sequence in sequence_map.items():
                if segment.text in candidate_line or candidate_line in segment.text:
                    sequence_number = candidate_sequence
                    break
        if sequence_number is None:
            sequence_number = 1
        normalized_text = _normalize_whitespace(segment.text)
        topic_key = _topic_key(normalized_text)
        dedupe_key = (memory_type, topic_key, sequence_number)
        if dedupe_key in seen_keys:
            continue
        seen_keys.add(dedupe_key)
        line_range = f"lines {segment.line_start}-{segment.line_end}"
        evidence_span = f"{line_range}: {normalized_text[:220]}"
        items.append(
            ExtractionItem(
                memory_type=memory_type,
                label=_trim_label(normalized_text),
                normalized_text=normalized_text,
                sequence_number=sequence_number,
                evidence_span=evidence_span,
                confidence_score=round(confidence, 2),
                event_timestamp=_extract_segment_timestamp(normalized_text, artifact_timestamp),
                topic_key=topic_key,
                extraction_method="heuristic",
                owner_hint=_extract_owner_hint(normalized_text) if memory_type == "commitment" else None,
                due_date=_extract_due_date_hint(normalized_text) if memory_type == "commitment" else None,
            )
        )
    return items, ExtractionDiagnostics(extraction_method="heuristic", fallback_reason=fallback_reason if settings.local_llm_enabled else None)


def _create_graph_node(db: Session, *, workspace_id: str, node_type: str, entity_id: str, title_or_label: str, visibility_scope: str) -> GraphNode:
    existing = db.scalar(
        select(GraphNode).where(
            GraphNode.workspace_id == workspace_id,
            GraphNode.node_type == node_type,
            GraphNode.entity_id == entity_id,
        )
    )
    if existing is not None:
        existing.title_or_label = title_or_label
        existing.visibility_scope = visibility_scope
        db.flush()
        return existing
    node = GraphNode(
        workspace_id=workspace_id,
        node_type=node_type,
        entity_id=entity_id,
        title_or_label=title_or_label,
        visibility_scope=visibility_scope,
    )
    db.add(node)
    db.flush()
    return node


def _create_edge_if_missing(
    db: Session,
    *,
    workspace_id: str,
    from_node_id: str,
    to_node_id: str,
    edge_type: str,
    evidence_artifact_id: str | None,
    evidence_chunk_id: str | None,
    evidence_span: str | None,
    confidence_score: float,
) -> None:
    existing = db.scalar(
        select(GraphEdge).where(
            GraphEdge.workspace_id == workspace_id,
            GraphEdge.from_node_id == from_node_id,
            GraphEdge.to_node_id == to_node_id,
            GraphEdge.edge_type == edge_type,
            GraphEdge.evidence_artifact_id == evidence_artifact_id,
        )
    )
    if existing is not None:
        return
    db.add(
        GraphEdge(
            workspace_id=workspace_id,
            from_node_id=from_node_id,
            to_node_id=to_node_id,
            edge_type=edge_type,
            evidence_artifact_id=evidence_artifact_id,
            evidence_chunk_id=evidence_chunk_id,
            evidence_span=evidence_span,
            confidence_score=confidence_score,
        )
    )


def _replace_fts_rows(db: Session, artifact: Artifact, chunks: list[ArtifactChunk]) -> None:
    db.execute(text("DELETE FROM artifact_chunks_fts WHERE artifact_id = :artifact_id"), {"artifact_id": artifact.artifact_id})
    for chunk in chunks:
        db.execute(
            text(
                "INSERT INTO artifact_chunks_fts (chunk_id, artifact_id, workspace_id, text) VALUES (:chunk_id, :artifact_id, :workspace_id, :text)"
            ),
            {
                "chunk_id": chunk.chunk_id,
                "artifact_id": artifact.artifact_id,
                "workspace_id": artifact.workspace_id,
                "text": chunk.text,
            },
        )


def _memory_entity_ids_for_artifact(db: Session, artifact_id: str) -> list[str]:
    entity_ids: list[str] = []
    for model, pk_name in MEMORY_MODELS.values():
        rows = db.scalars(select(model).where(model.source_artifact_id == artifact_id)).all()
        entity_ids.extend(getattr(row, pk_name) for row in rows)
    return entity_ids


def _store_memory_item(db: Session, *, artifact: Artifact, chunk: ArtifactChunk, item: ExtractionItem) -> PersistedMemory:
    model, pk_name = MEMORY_MODELS[item.memory_type]
    common_kwargs = dict(
        workspace_id=artifact.workspace_id,
        source_artifact_id=artifact.artifact_id,
        source_chunk_id=chunk.chunk_id,
        evidence_span=item.evidence_span,
        confidence_score=item.confidence_score,
        event_timestamp=item.event_timestamp,
        normalized_text=item.normalized_text,
        title_or_label=item.label,
        topic_key=item.topic_key,
        extraction_method=item.extraction_method,
    )
    if item.memory_type == "decision":
        entity = model(status="active", **common_kwargs)
    elif item.memory_type == "assumption":
        entity = model(status="active", validity_notes="Awaiting later evidence review.", **common_kwargs)
    elif item.memory_type == "constraint":
        entity = model(category="delivery", **common_kwargs)
    elif item.memory_type == "outcome":
        entity = model(outcome_type="observed", **common_kwargs)
    else:
        entity = model(status="open", owner_label=item.owner_hint, due_date=item.due_date, **common_kwargs)
    db.add(entity)
    db.flush()
    entity_id = getattr(entity, pk_name)
    artifact_node = _create_graph_node(
        db,
        workspace_id=artifact.workspace_id,
        node_type="artifact",
        entity_id=artifact.artifact_id,
        title_or_label=artifact.title,
        visibility_scope=artifact.visibility_scope,
    )
    memory_node = _create_graph_node(
        db,
        workspace_id=artifact.workspace_id,
        node_type=item.memory_type,
        entity_id=entity_id,
        title_or_label=item.label,
        visibility_scope=artifact.visibility_scope,
    )
    _create_edge_if_missing(
        db,
        workspace_id=artifact.workspace_id,
        from_node_id=memory_node.node_id,
        to_node_id=artifact_node.node_id,
        edge_type="MENTIONED_IN",
        evidence_artifact_id=artifact.artifact_id,
        evidence_chunk_id=chunk.chunk_id,
        evidence_span=item.evidence_span,
        confidence_score=item.confidence_score,
    )
    return PersistedMemory(
        memory_type=item.memory_type,
        memory_id=entity_id,
        node_id=memory_node.node_id,
        title_or_label=item.label,
        normalized_text=item.normalized_text,
        source_artifact_id=artifact.artifact_id,
        source_chunk_id=chunk.chunk_id,
        event_timestamp=item.event_timestamp,
        confidence_score=item.confidence_score,
        topic_key=item.topic_key,
        extraction_method=item.extraction_method,
        status="open" if item.memory_type == "commitment" else ("active" if item.memory_type in {"decision", "assumption"} else None),
        owner_hint=item.owner_hint,
        due_date=item.due_date,
    )


def _load_persisted_memories(db: Session, workspace_id: str) -> list[PersistedMemory]:
    records: list[PersistedMemory] = []
    for memory_type, (model, pk_name) in MEMORY_MODELS.items():
        rows = db.scalars(select(model).where(model.workspace_id == workspace_id)).all()
        for row in rows:
            node = db.scalar(
                select(GraphNode).where(
                    GraphNode.workspace_id == workspace_id,
                    GraphNode.node_type == memory_type,
                    GraphNode.entity_id == getattr(row, pk_name),
                )
            )
            if node is None:
                continue
            records.append(
                PersistedMemory(
                    memory_type=memory_type,
                    memory_id=getattr(row, pk_name),
                    node_id=node.node_id,
                    title_or_label=row.title_or_label,
                    normalized_text=row.normalized_text,
                    source_artifact_id=row.source_artifact_id,
                    source_chunk_id=row.source_chunk_id,
                    event_timestamp=row.event_timestamp,
                    confidence_score=row.confidence_score,
                    topic_key=row.topic_key,
                    extraction_method=getattr(row, "extraction_method", "heuristic"),
                    status=getattr(row, "status", None),
                    owner_hint=getattr(row, "owner_label", None),
                    due_date=getattr(row, "due_date", None),
                )
            )
    return records


def _is_supersede_relationship(earlier: PersistedMemory, later: PersistedMemory) -> bool:
    if _token_overlap(earlier.title_or_label, later.title_or_label) < 2:
        return False
    if later.event_timestamp <= earlier.event_timestamp:
        return False
    return any(term in later.normalized_text.lower() for term in ("reintroduce", "revert", "instead", "update", "move", "delay", "advance", "launch"))


def _is_contradiction_relationship(earlier: PersistedMemory, later: PersistedMemory) -> bool:
    if _token_overlap(earlier.title_or_label, later.title_or_label) < 2:
        return False
    combined = f"{earlier.normalized_text.lower()} {later.normalized_text.lower()}"
    if "q2" in combined and "q3" in combined:
        return True
    if any(term in combined for term in CONTRADICTION_TERMS):
        return any(term in earlier.normalized_text.lower() for term in ("delay", "q3", "revert")) and any(
            term in later.normalized_text.lower() for term in ("q2", "launch", "reintroduce", "keep")
        )
    return False


def _link_decision_context(db: Session, memories: list[PersistedMemory], artifact_id: str, workspace_id: str) -> None:
    decisions = [memory for memory in memories if memory.memory_type == "decision" and memory.source_artifact_id == artifact_id]
    assumptions = [memory for memory in memories if memory.memory_type == "assumption"]
    constraints = [memory for memory in memories if memory.memory_type == "constraint"]
    outcomes = [memory for memory in memories if memory.memory_type == "outcome"]
    commitments = [memory for memory in memories if memory.memory_type == "commitment"]

    for decision in decisions:
        for assumption in assumptions:
            if assumption.source_artifact_id == decision.source_artifact_id and _token_overlap(decision.title_or_label, assumption.title_or_label) >= 1:
                _create_edge_if_missing(
                    db,
                    workspace_id=workspace_id,
                    from_node_id=decision.node_id,
                    to_node_id=assumption.node_id,
                    edge_type="BASED_ON",
                    evidence_artifact_id=decision.source_artifact_id,
                    evidence_chunk_id=decision.source_chunk_id,
                    evidence_span=decision.title_or_label,
                    confidence_score=min(decision.confidence_score, assumption.confidence_score),
                )
        for constraint in constraints:
            if constraint.source_artifact_id == decision.source_artifact_id and _token_overlap(decision.title_or_label, constraint.title_or_label) >= 1:
                _create_edge_if_missing(
                    db,
                    workspace_id=workspace_id,
                    from_node_id=decision.node_id,
                    to_node_id=constraint.node_id,
                    edge_type="CONSTRAINED_BY",
                    evidence_artifact_id=decision.source_artifact_id,
                    evidence_chunk_id=decision.source_chunk_id,
                    evidence_span=constraint.title_or_label,
                    confidence_score=min(decision.confidence_score, constraint.confidence_score),
                )
        for outcome in outcomes:
            if _token_overlap(decision.title_or_label, outcome.title_or_label) >= 1 and outcome.event_timestamp >= decision.event_timestamp:
                _create_edge_if_missing(
                    db,
                    workspace_id=workspace_id,
                    from_node_id=decision.node_id,
                    to_node_id=outcome.node_id,
                    edge_type="RESULTED_IN",
                    evidence_artifact_id=outcome.source_artifact_id,
                    evidence_chunk_id=outcome.source_chunk_id,
                    evidence_span=outcome.title_or_label,
                    confidence_score=min(decision.confidence_score, outcome.confidence_score),
                )
        for commitment in commitments:
            if _token_overlap(decision.title_or_label, commitment.title_or_label) >= 1:
                _create_edge_if_missing(
                    db,
                    workspace_id=workspace_id,
                    from_node_id=decision.node_id,
                    to_node_id=commitment.node_id,
                    edge_type="RELATES_TO",
                    evidence_artifact_id=commitment.source_artifact_id,
                    evidence_chunk_id=commitment.source_chunk_id,
                    evidence_span=commitment.title_or_label,
                    confidence_score=min(decision.confidence_score, commitment.confidence_score),
                )


def _link_decision_timeline(db: Session, memories: list[PersistedMemory], artifact_id: str, workspace_id: str) -> None:
    current_decisions = [memory for memory in memories if memory.memory_type == "decision" and memory.source_artifact_id == artifact_id]
    all_decisions = sorted([memory for memory in memories if memory.memory_type == "decision"], key=lambda item: item.event_timestamp)
    for decision in current_decisions:
        for earlier in all_decisions:
            if earlier.memory_id == decision.memory_id:
                continue
            if _is_supersede_relationship(earlier, decision):
                _create_edge_if_missing(
                    db,
                    workspace_id=workspace_id,
                    from_node_id=decision.node_id,
                    to_node_id=earlier.node_id,
                    edge_type="SUPERSEDES",
                    evidence_artifact_id=decision.source_artifact_id,
                    evidence_chunk_id=decision.source_chunk_id,
                    evidence_span=decision.title_or_label,
                    confidence_score=min(decision.confidence_score, earlier.confidence_score),
                )
            if _is_contradiction_relationship(earlier, decision):
                _create_edge_if_missing(
                    db,
                    workspace_id=workspace_id,
                    from_node_id=decision.node_id,
                    to_node_id=earlier.node_id,
                    edge_type="CONTRADICTS",
                    evidence_artifact_id=decision.source_artifact_id,
                    evidence_chunk_id=decision.source_chunk_id,
                    evidence_span=decision.title_or_label,
                    confidence_score=min(decision.confidence_score, earlier.confidence_score),
                )


def _update_assumption_drift(db: Session, memories: list[PersistedMemory], artifact_id: str, workspace_id: str) -> None:
    current_artifact_memories = [memory for memory in memories if memory.source_artifact_id == artifact_id]
    assumptions = [memory for memory in memories if memory.memory_type == "assumption"]
    for assumption_memory in assumptions:
        assumption_row = db.scalar(select(Assumption).where(Assumption.assumption_id == assumption_memory.memory_id))
        if assumption_row is None:
            continue
        related_signals = [
            memory
            for memory in current_artifact_memories
            if memory.memory_type in {"outcome", "decision", "constraint", "commitment"}
            and memory.event_timestamp >= assumption_memory.event_timestamp
            and _token_overlap(memory.title_or_label, assumption_memory.title_or_label) >= 1
        ]
        if not related_signals:
            continue
        strongest_signal = related_signals[0]
        combined_text = " ".join(signal.normalized_text.lower() for signal in related_signals)
        if any(pattern.search(combined_text) for pattern in NEGATIVE_OUTCOME_PATTERNS):
            assumption_row.status = "stale"
            assumption_row.validity_notes = f"Later evidence weakened this assumption: {strongest_signal.title_or_label}"
        if any(term in combined_text for term in ("reintroduce", "revert", "instead", "launch in q2", "delay to q3")):
            assumption_row.status = "reversed"
            assumption_row.validity_notes = f"Later decision shifted the operating basis: {strongest_signal.title_or_label}"
        for signal in related_signals:
            _create_edge_if_missing(
                db,
                workspace_id=workspace_id,
                from_node_id=signal.node_id,
                to_node_id=assumption_memory.node_id,
                edge_type="RELATES_TO",
                evidence_artifact_id=signal.source_artifact_id,
                evidence_chunk_id=signal.source_chunk_id,
                evidence_span=signal.title_or_label,
                confidence_score=min(signal.confidence_score, assumption_memory.confidence_score),
            )


def run_ingestion(db: Session, *, artifact: Artifact, actor: User) -> IngestionJob:
    job = IngestionJob(
        workspace_id=artifact.workspace_id,
        artifact_id=artifact.artifact_id,
        created_by=actor.user_id,
        status="running",
        stage="extract_text",
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    log_event(
        db,
        workspace_id=artifact.workspace_id,
        actor_user_id=actor.user_id,
        event_type="INGESTION_RUN_CREATED",
        target_type="artifact",
        target_id=artifact.artifact_id,
        event_metadata={"job_id": job.job_id},
    )
    try:
        artifact_text = extract_text_for_artifact(artifact)
        artifact.extracted_text = artifact_text
        artifact.ingestion_status = "processing"
        prior_entity_ids = _memory_entity_ids_for_artifact(db, artifact.artifact_id)
        db.query(ArtifactChunk).where(ArtifactChunk.artifact_id == artifact.artifact_id).delete(synchronize_session=False)
        db.execute(delete(GraphEdge).where(GraphEdge.evidence_artifact_id == artifact.artifact_id))
        if prior_entity_ids:
            db.execute(delete(GraphNode).where(GraphNode.workspace_id == artifact.workspace_id, GraphNode.entity_id.in_(prior_entity_ids)))
        for model, _pk_name in MEMORY_MODELS.values():
            db.execute(delete(model).where(model.source_artifact_id == artifact.artifact_id))
        db.commit()

        job.stage = "chunking"
        db.commit()
        chunks = chunk_text(artifact_text)
        stored_chunks: list[ArtifactChunk] = []
        for index, chunk_text_value in enumerate(chunks, start=1):
            chunk = ArtifactChunk(
                artifact_id=artifact.artifact_id,
                workspace_id=artifact.workspace_id,
                sequence_number=index,
                text=chunk_text_value,
                chunk_metadata={"char_length": len(chunk_text_value)},
            )
            db.add(chunk)
            db.flush()
            stored_chunks.append(chunk)
        _replace_fts_rows(db, artifact, stored_chunks)

        job.stage = "structured_extraction"
        db.commit()
        candidates, extraction_diagnostics = extract_memory_candidates(chunks, artifact, artifact_text)
        chunk_by_seq = {chunk.sequence_number: chunk for chunk in stored_chunks}
        extracted_counts = {key: 0 for key in MEMORY_MODELS}
        per_chunk_object_counts = {chunk.sequence_number: 0 for chunk in stored_chunks}
        persisted_items: list[PersistedMemory] = []
        for item in candidates:
            chunk = chunk_by_seq.get(item.sequence_number)
            if chunk is None:
                continue
            persisted_items.append(_store_memory_item(db, artifact=artifact, chunk=chunk, item=item))
            extracted_counts[item.memory_type] += 1
            per_chunk_object_counts[item.sequence_number] += 1

        for chunk in stored_chunks:
            chunk.chunk_metadata = {
                **(chunk.chunk_metadata or {}),
                "extraction_method": extraction_diagnostics.extraction_method,
                "extraction_status": "completed",
                "extracted_object_count": per_chunk_object_counts.get(chunk.sequence_number, 0),
                "fallback_reason": extraction_diagnostics.fallback_reason,
                "chunk_excerpt": (chunk.text[:200] + "...") if len(chunk.text) > 200 else chunk.text,
            }

        job.stage = "graph_linking"
        db.commit()
        all_memories = _load_persisted_memories(db, artifact.workspace_id)
        _link_decision_context(db, all_memories, artifact.artifact_id, artifact.workspace_id)
        _link_decision_timeline(db, all_memories, artifact.artifact_id, artifact.workspace_id)
        _update_assumption_drift(db, all_memories, artifact.artifact_id, artifact.workspace_id)

        artifact.ingestion_status = "completed"
        job.status = "completed"
        job.detail = (
            f"Stored {len(stored_chunks)} chunks and {sum(extracted_counts.values())} extracted memory objects "
            f"using {extraction_diagnostics.extraction_method} extraction."
        )
        db.commit()
        log_event(
            db,
            workspace_id=artifact.workspace_id,
            actor_user_id=actor.user_id,
            event_type="EXTRACTION_PERSISTED",
            target_type="artifact",
            target_id=artifact.artifact_id,
            event_metadata={"job_id": job.job_id, "counts": extracted_counts},
        )
        log_event(
            db,
            workspace_id=artifact.workspace_id,
            actor_user_id=actor.user_id,
            event_type="GRAPH_UPDATED",
            target_type="artifact",
            target_id=artifact.artifact_id,
            event_metadata={"job_id": job.job_id, "counts": extracted_counts},
        )
        from app.services.querying import persist_artifact_proactive_signals

        proactive_summary = persist_artifact_proactive_signals(db, actor, artifact)
        log_event(
            db,
            workspace_id=artifact.workspace_id,
            actor_user_id=actor.user_id,
            event_type="PROACTIVE_SIGNALS_GENERATED",
            target_type="artifact",
            target_id=artifact.artifact_id,
            event_metadata={
                "job_id": job.job_id,
                "signal_counts": proactive_summary["signal_counts"],
                "persisted_signal_count": sum(proactive_summary["signal_counts"].values()),
            },
        )
        db.refresh(job)
        return job
    except Exception as exc:
        job.status = "failed"
        job.stage = "failed"
        job.detail = str(exc)
        artifact.ingestion_status = "failed"
        db.commit()
        raise
