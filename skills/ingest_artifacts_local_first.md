---
skill_id: ingest_artifacts_local_first
version: "1.1"
priority: "P0"
source_projects: ["Graphiti", "Neo4j GraphRAG", "TrustGraph", "PyMuPDF", "Docling", "FastAPI"]
consumes: ["UploadFile", "pasted_text"]
produces: ["artifacts", "artifact_chunks", "filesystem_blob", "chunk_lineage"]
depends_on: []
---

# Artifact Ingestion and Normalization

## Short description
Persist supported artifacts locally, extract text without OCR, normalize it deterministically, and emit immutable ordered chunks that can support later extraction, provenance tracing, and timeline reconstruction.

## Why this skill exists
Izge is not a generic chat layer over files. Its ingestion step has to create a durable evidence base that later skills can trust. The main lesson from Graphiti, Neo4j GraphRAG, and TrustGraph is the same: source material should be preserved as immutable evidence, chunking should be deterministic, and provenance should begin at the first byte written to disk rather than being reconstructed later from loose metadata.

This means ingestion is not just file upload plumbing. It is the point where Izge decides:

- what the canonical artifact blob is,
- what parser version produced the text,
- how chunks are ordered,
- how every future memory object will map back to an exact artifact region,
- and where coverage gaps or parser failures must be disclosed.

## Core rules to borrow from the source projects

### 1. Preserve the raw source first
Graphiti's "episode first" model and TrustGraph's provenance model both assume that derived knowledge must point back to an immutable source event. For Izge, the equivalent rule is:

- write original bytes first,
- checksum them before parsing,
- never mutate the stored blob,
- and treat all later text, chunks, objects, and graph edges as derived artifacts.

### 2. Build a lightweight lexical graph during ingestion
Neo4j GraphRAG's lexical graph pattern is worth stealing in reduced form:

- `Artifact`
- ordered `Chunk`
- adjacency links such as `NEXT_CHUNK`
- optional `PAGE` records for PDFs

Do not wait until reasoning time to reconstruct chunk order. Persist it once.

### 3. Coverage gaps are first-class output
If parsing partially fails, Izge should continue when safe, but it must emit explicit coverage metadata such as:

- skipped pages,
- empty extracted pages,
- parser warnings,
- unsupported embedded objects,
- and chunk ranges with low confidence.

TrustGraph's provenance discipline is useful here: the system should say exactly what it saw and exactly what it could not decode.

## Supported artifact policy

### Accept
- `.md`
- `.txt`
- `.pdf`
- pasted plain text

### Reject
- image-only PDFs that require OCR
- `.docx`, `.pptx`, spreadsheets, images, audio, or archives in MVP
- remote URLs as direct ingestion input unless another skill has already materialized them locally

Reject early, before parsing or background scheduling. Unsupported formats should not create partial artifact records that later look trustworthy.

## Target data contracts

### ArtifactRecord
- `artifact_id`
- `workspace_id`
- `artifact_kind`
- `original_filename`
- `mime_type`
- `blob_checksum_sha256`
- `blob_path`
- `byte_size`
- `visibility_scope`
- `parser_family`
- `parser_version`
- `ingested_at`

### ArtifactChunk
- `chunk_id`
- `artifact_id`
- `ordinal`
- `page_no`
- `section_label`
- `text`
- `normalized_text`
- `start_char`
- `end_char`
- `source_locator`
- `content_hash`
- `prev_chunk_id`
- `next_chunk_id`

### ChunkLineage
- `artifact_id`
- `chunk_id`
- `page_no`
- `char_start`
- `char_end`
- `parser_version`
- `coverage_status`
- `coverage_note`

## Implementation blueprint

### Step 1. Save bytes before parsing
1. Read the upload stream once.
2. Compute `sha256`.
3. Write bytes to a checksum-derived path.
4. Create the artifact row immediately.

Recommended storage pattern:

- path root by workspace or environment
- first two checksum characters as shard directory
- full checksum as filename

This gives stable deduplication without inventing user-facing path semantics.

### Step 2. Parse by file type with minimal transformation

#### Markdown and plain text
- decode as UTF-8
- normalize line endings to `\n`
- preserve headings and lists
- remove only transport noise such as repeated null characters or invalid control bytes

#### PDF
- use text extraction only
- preserve page numbers
- prefer parser output that respects natural reading order
- if page text is empty, record that explicitly instead of silently dropping the page

Escalate from `PyMuPDF` to `Docling` only when ordering or structural quality is materially worse. Do not turn ingestion into a parser framework contest.

### Step 3. Normalize text without erasing evidence
Normalization should make extraction stable, not cleaner for humans at the cost of fidelity.

Good normalization:
- normalize newlines
- trim leading and trailing whitespace
- collapse repeated blank lines when they are parser artifacts

Bad normalization:
- rewriting sentences
- removing bullets or headings
- deleting timestamps
- merging table rows into prose without traceability

Store both `text` and `normalized_text` when normalization is non-trivial.

### Step 4. Chunk deterministically
Chunking should be stable across reruns given the same:

- artifact blob,
- parser version,
- chunking policy,
- and normalization policy.

Borrowed from Neo4j GraphRAG's lexical-graph mindset:

- chunk in artifact order,
- keep adjacency,
- keep page boundaries when possible,
- and make chunk IDs derivable from artifact-local coordinates.

Recommended strategy:
- default target size: `900-1400` characters for prose
- overlap: `120-180` characters
- hard stop at section or page boundaries when possible
- avoid splitting inside headings or bullet prefixes if a near boundary exists

Recommended chunk ID input:

```text
sha256(artifact_id + parser_version + ordinal + start_char + end_char + normalized_text)
```

### Step 5. Persist chunk lineage before extraction
Memory extraction, graph persistence, and UI inspection all depend on chunk lineage already existing. Persist:

- chunk rows,
- adjacency,
- page mapping,
- parser metadata,
- and coverage notes

before any extraction worker starts.

### Step 6. Emit parser coverage notes
If the parser returns:

- empty pages,
- malformed Unicode,
- or mixed ordering

store that in a machine-readable note table or JSON field tied to the artifact, then surface it downstream as an uncertainty source.

## Borrowed know-how by project

### From Graphiti
- Treat the ingested source as an immutable evidence event.
- Keep the notion of ordered prior context available for later extraction.
- Distinguish dense structured content from normal prose when chunking policy changes are required.

### From Neo4j GraphRAG
- Build a lexical graph, not just a list of chunk strings.
- Separate loader, splitter, and downstream extractor responsibilities.
- Permit partial failure while preserving enough metadata to explain missing coverage.

### From TrustGraph
- Build provenance from `artifact -> page -> chunk` immediately.
- Prefer one clear provenance chain over opaque parser metadata blobs.
- Record what was derived from which chunk, and what was not decoded.

## Minimal reproducible code snippets

```python
from pathlib import Path
import hashlib
import fitz

def save_blob(root: Path, data: bytes) -> tuple[str, Path]:
    checksum = hashlib.sha256(data).hexdigest()
    path = root / checksum[:2] / checksum
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return checksum, path

def pdf_to_pages(path: Path) -> list[dict]:
    doc = fitz.open(path)
    pages = []
    for i, page in enumerate(doc):
        pages.append(
            {
                "page_no": i + 1,
                "text": page.get_text("text", sort=True),
            }
        )
    return pages
```

```sql
CREATE TABLE IF NOT EXISTS artifact_chunks (
  chunk_id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  page_no INTEGER,
  text TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  start_char INTEGER NOT NULL,
  end_char INTEGER NOT NULL,
  prev_chunk_id TEXT,
  next_chunk_id TEXT,
  parser_version TEXT NOT NULL
);
```

## Integration notes
- Return HTTP `202` for slow ingestion and move parsing to a background job only after the original blob is durably written.
- Keep parser choice and parser version on the artifact record so future reruns can explain extraction drift.
- Expose chunk lineage through the API; later skills should not scrape it from internal tables.

## Anti-patterns to avoid
- Computing chunks before the blob is stored.
- Hiding parser failures and pretending the artifact is fully covered.
- Re-chunking dynamically during query handling and generating different evidence ranges every run.
- Letting OCR or image extraction creep into MVP ingestion.
- Normalizing so aggressively that evidence spans can no longer be mapped back to the source text.

## Testing / validation steps
- Re-ingest the same `.md`, `.txt`, and text-extractable `.pdf` twice and verify stable checksum, chunk order, and chunk IDs.
- Verify page numbers and chunk boundaries for PDFs with multi-column or table-heavy pages.
- Assert that unsupported file types fail before artifact creation.
- Add regression fixtures for empty-page PDFs and parser-warning scenarios.

## Performance considerations
- Keep parsing and chunking linear in artifact size.
- Defer embeddings and extraction; ingestion should finish as soon as the evidence substrate is stable.
- If parser quality differs by file family, choose the slower parser only for the problematic family instead of globally.

## Security / privacy / licensing notes
- Do not send artifact bytes or extracted text to external services during ingestion.
- Enforce artifact visibility at artifact creation time so later stages inherit it.
- PyMuPDF licensing must be reviewed for production packaging; Docling's package license does not remove the need to review bundled model or parser dependencies.

## References
- Graphiti episode-first ingestion and dense-vs-normal episode chunking patterns
- Neo4j GraphRAG lexical graph and staged pipeline design
- TrustGraph chunk-to-source provenance chain design
