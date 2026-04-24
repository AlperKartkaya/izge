---
skill_id: extract_memory_objects_schema_first
version: "1.1"
priority: "P0"
source_projects: ["Graphiti", "Mem0", "Neo4j GraphRAG", "Pydantic", "Ollama", "llama.cpp"]
consumes: ["artifact_chunks"]
produces: ["memory_objects", "claim_occurrences", "object_links"]
depends_on: ["ingest_artifacts_local_first"]
---

# Schema-Constrained Memory Extraction

## Short description
Extract typed memory objects from local artifact chunks using strict schemas, additive extraction rules, evidence spans, and post-validation normalization rather than free-form summary prompts.

## Why this skill exists
Izge's graph is only as good as the objects it stores. The upstream projects point to a clear rule: extraction quality improves when the model is asked to do a narrow, well-specified job and when the system preserves additive history instead of trying to "maintain" a current summary in place.

The main pieces worth stealing are:

- Graphiti's temporal fact discipline,
- Neo4j GraphRAG's stage separation and schema-first pipeline shape,
- Mem0's add-only extraction and related-memory linking,
- and Pydantic-backed structured output validation.

## Extraction posture

### Additive, not corrective
Extraction should append newly observed claim occurrences. It should not update or delete prior memory objects during extraction. Any later supersession or contradiction judgment belongs to graph-linking and analysis stages.

### Chunk-local, not corpus-wide
Do not ask the model to synthesize entire documents into memory objects in one shot. Extract from one chunk at a time, with only enough neighboring context to resolve references and dates.

### Evidence-bound
Every object must carry:

- exact `source_chunk_id`,
- quoted supporting span,
- normalized temporal anchor,
- and extraction metadata.

If the model cannot point to an evidence span, the object is not ready for persistence.

## Target object model

### MemoryObject
- `object_id`
- `kind`
- `text`
- `subject_key`
- `claim_family_key`
- `evidence_quote`
- `source_chunk_id`
- `source_artifact_id`
- `observed_at`
- `ingested_at`
- `actors`
- `topics`
- `confidence`
- `attributed_to`
- `linked_object_ids`

### Supported kinds in MVP
- `decision`
- `proposal`
- `assumption`
- `constraint`
- `outcome`
- `commitment`
- `question`

The important detail is not the label count. It is that each kind has a stable schema and a deliberate normalization path.

## Borrowed know-how by project

### From Mem0
- Use add-only extraction.
- Use existing memories only for deduplication and linking, not as source material for new facts.
- Capture context-rich memories rather than brittle atomic fragments when a single object can safely preserve the richer meaning.

### From Graphiti
- Preserve claim timing with explicit fields instead of vague timestamps.
- Feed recent prior episodes only to help interpret references, not to let the model overwrite history.
- Attribute multi-source facts to the exact contributing episode or chunk when more than one local context block is supplied.

### From Neo4j GraphRAG
- Use strict schemas per phase.
- Prefer a smaller schema per object family or extractor stage over one giant output envelope.
- Keep extraction distinct from pruning, resolution, and writing.

## Extraction blueprint

### Step 1. Choose the schema before the model call
Use explicit Pydantic models or JSON Schema generated from them. The extractor prompt should not define the schema in prose alone.

Recommended pattern:
- one envelope schema for the response,
- one discriminated schema per object kind,
- validators for confidence, dates, and required evidence fields.

### Step 2. Give the model only local evidence
Input packet per extraction run:
- current chunk text,
- chunk ID,
- artifact ID,
- page and offset metadata,
- optional previous and next chunk summaries,
- observation date if the artifact has one,
- allowed object kinds,
- optional related prior objects for dedup/linking only

Do not include a whole-document summary unless the extractor explicitly needs a document title or artifact metadata.

### Step 3. Require extraction-time grounding
For each emitted object, require:
- an `evidence_quote`,
- a `source_chunk_id`,
- and either `observed_at` or a `temporal_resolution_note`

If a date is relative, resolve it against artifact-local evidence first, then artifact metadata, then ingestion time as a last resort. Never silently convert vague dates to "today".

### Step 4. Validate before normalization
The model output is untrusted until schema validation succeeds.

Reject or quarantine outputs when:
- confidence is outside `[0, 1]`,
- evidence is missing,
- object kind is unknown,
- temporal fields are malformed,
- or actor/topic structures fail validation.

### Step 5. Normalize after validation
Post-validation normalization should:
- canonicalize actors and teams,
- derive `subject_key`,
- derive `claim_family_key`,
- normalize topic labels,
- and generate deterministic IDs

Deterministic ID input should include normalized text, object kind, chunk ID, and evidence span so retries produce the same object identity when the underlying fact is unchanged.

### Step 6. Link, do not overwrite
If the new object is related to an existing object:
- keep both,
- store the link,
- and defer contradiction or supersession labeling to downstream stages.

Examples:
- new assumption on same topic -> link by `claim_family_key`
- commitment with same owner and deliverable -> link as same commitment family
- outcome that follows a decision -> link by shared subject or referenced initiative

## Prompting rules
- Tell the model what kinds are allowed.
- Tell it to skip vague summaries without evidence.
- Tell it to emit one object per memory-worthy claim, unless the claim and its context are inseparable.
- Tell it to keep wording factual and self-contained.
- Tell it that existing memories are for duplicate checking and linking only.

This is a direct translation of the best part of Mem0's additive prompt design into Izge's institutional-memory domain.

## Recommended object decomposition

### Keep as one object when
- the main fact and its surrounding qualifier are inseparable
- the richer wording is what makes the memory useful later

Example:
- "Beta launch moved from late November to early December because the holiday freeze reduced QA time."

### Split into multiple objects when
- the chunk contains a decision and the reason supporting it,
- a constraint and an outcome,
- or a commitment and a due date owned by different actors

Example split:
- decision: launch moved to early December
- constraint: holiday freeze reduces QA time

## Minimal reproducible code snippets

```python
from typing import Literal, Optional
from pydantic import BaseModel, field_validator
from ollama import chat

class MemoryObject(BaseModel):
    kind: Literal[
        "decision", "proposal", "assumption", "constraint",
        "outcome", "commitment", "question"
    ]
    text: str
    evidence_quote: str
    source_chunk_id: str
    confidence: float
    observed_at: Optional[str] = None

    @field_validator("confidence")
    @classmethod
    def validate_confidence(cls, value: float) -> float:
        if not 0 <= value <= 1:
            raise ValueError("confidence must be in [0,1]")
        return value

class ExtractionEnvelope(BaseModel):
    objects: list[MemoryObject]

def extract_objects(chunk_id: str, text: str) -> ExtractionEnvelope:
    schema = ExtractionEnvelope.model_json_schema()
    response = chat(
        model="<local-extract-model>",
        messages=[
            {
                "role": "user",
                "content": f"Extract memory objects from chunk {chunk_id}.\n\n{text}",
            }
        ],
        format=schema,
    )
    return ExtractionEnvelope.model_validate_json(response.message.content)
```

## Integration notes
- Store raw model output for debugging, but never persist derived objects without validation.
- Keep extractor version, model identifier, and schema version on every extraction run.
- Use a separate linking stage to attach `linked_object_ids` after normalization.
- If different object kinds need materially different prompts, split the extractor into multiple passes instead of forcing one universal prompt.

## Anti-patterns to avoid
- One mega-schema that tries to extract every possible object and relation in one response.
- Updating prior objects during extraction.
- Storing summary text with no evidence quote.
- Using existing memory text as if it were source evidence.
- Deriving claim families from fuzzy similarity alone.

## Testing / validation steps
- Build a golden set with at least one example per object kind.
- Assert every persisted object includes evidence, source chunk, and extractor version.
- Add regressions for ambiguous dates, multiple actors, and nested decisions-with-rationale chunks.
- Add a dedup-linking test where a new occurrence links to an existing family without overwriting it.

## Performance considerations
- Use structured output-capable local models when possible.
- Smaller local models usually fail first on dates, owners, and nuanced constraints; benchmark recall before locking them in.
- Cache chunk-local context preparation and schema objects to reduce per-call overhead.

## Security / privacy / licensing notes
- Keep extraction local.
- Do not emit evidence quotes from artifacts a user cannot access.
- Store visible evidence and restricted evidence in the same schema, but gate them before answer composition.

## References
- Graphiti temporal extraction and episode attribution patterns
- Mem0 additive extraction and related-memory linking patterns
- Neo4j GraphRAG schema-first pipeline discipline
