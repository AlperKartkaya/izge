---
skill_id: classify_queries_and_assemble_context
version: "1.1"
priority: "P0"
source_projects: ["Graphiti", "Neo4j GraphRAG", "TrustGraph", "Haystack"]
consumes: ["user_query", "graph_nodes", "graph_edges", "chunk_fts"]
produces: ["query_class", "analysis_context"]
depends_on: ["persist_decision_graph_sqlite"]
---

# Query Classification and Context Assembly

## Short description
Route a user query into one of Izge's fixed reasoning modes, then assemble a small typed context packet containing only the nodes, edges, and evidence needed for that mode.

## Why this skill exists
The strongest shared lesson from the source systems is that retrieval should not be an undifferentiated "stuff context into the prompt" step. Query routing, candidate retrieval, reranking, and final context construction should be explicit and inspectable.

Izge already has four product-level query classes. This skill makes them operational:

- `decision_lineage`
- `contradiction_analysis`
- `assumption_drift`
- `next_action_guidance`

## Routing principles

### Deterministic first, model fallback second
Start with cheap heuristics and keyword plus intent patterns. Use a classifier model only when the query remains ambiguous.

### One query, one dominant route
Do not send a single query down multiple reasoning plans by default. If the query really spans multiple needs, pick the primary mode and note secondary intents in routing metadata.

### Permissions and scope before retrieval
Borrowed directly from Neo4j GraphRAG's pre-filtering stance and Izge's own contract:

- apply workspace scope,
- artifact visibility,
- artifact subset filters,
- and explicit time filters

before ranking or context assembly.

## Target output

### RouteDecision
- `query_class`
- `route_confidence`
- `route_rationale`
- `secondary_signals`

### AnalysisContext
- `seed_object_ids`
- `candidate_object_ids`
- `candidate_edge_ids`
- `selected_evidence_packets`
- `time_window`
- `permission_omitted_count`
- `coverage_gaps`
- `assembly_notes`

The context packet should be machine-readable and auditable. Prose comes later.

## Class-specific retrieval plans

### 1. Decision lineage
Goal: reconstruct how a decision emerged and what later changed it.

Plan:
1. identify seed decisions from exact filters or FTS plus object kind
2. walk `BASED_ON`, `SUPPORTED_BY`, `CONSTRAINED_BY`, `RESULTED_IN`, `SUPERSEDES`, and `REOPENS`
3. order the walk by `valid_from` or `observed_at`
4. collect paired evidence for each major step

### 2. Contradiction analysis
Goal: show opposing claims with evidence on both sides.

Plan:
1. derive target `claim_family_key` candidates
2. fetch occurrences and edges only within those families
3. assemble paired opposing evidence and temporal sequence
4. exclude merely adjacent but non-comparable claims

### 3. Assumption drift
Goal: determine whether an assumption was supported, weakened, reversed, or left unresolved.

Plan:
1. seed assumptions by topic or family
2. traverse into later decisions, outcomes, commitments, and metrics
3. collect weakening or reversing signals after the assumption's observation time
4. retain unresolved assumptions when no decisive follow-on evidence exists

### 4. Next action guidance
Goal: synthesize unresolved tensions and propose the next best evidence-backed action.

Plan:
1. collect unresolved contradictions
2. collect stale or reversed assumptions
3. collect open commitments and recent outcomes
4. prioritize by recency, severity, and dependency structure

This is not a document-retrieval query. Search is only the seed mechanism.

## Context assembly rules

### Use typed packets, not raw documents
Each selected evidence packet should include:
- `artifact_id`
- `chunk_id`
- `object_id`
- `edge_id`
- `evidence_quote`
- `page_no`
- `char_start`
- `char_end`
- `why_selected`

### Keep packets small
Assemble just enough context to support the reasoning step. Large prompt dumps hide weak retrieval quality and make auditing impossible.

### Preserve omissions and gaps
TrustGraph's trace discipline is worth copying here. The context packet should explicitly record:
- hidden evidence count
- chunk extraction failures
- unsupported artifact families
- and candidate sets rejected during narrowing

## Borrowed know-how by project

### From Graphiti
- Retrieval is a multi-stage process: search, rerank, construct.
- Hybrid retrieval works best when graph-aware reranking is treated as an explicit stage.
- Use fixed search recipes instead of open-ended query generation for core product routes.

### From Neo4j GraphRAG
- Pre-filters belong before search.
- `result_formatter`-style hooks are useful for turning raw records into typed context packets.
- Retrieval plans should follow explicit pipeline boundaries, not one giant prompt.

### From TrustGraph
- Context assembly should leave a trace.
- Explainability improves when the system records seeds, exploration steps, and selected evidence rather than only the final answer.

## Minimal reproducible code snippets

```python
from enum import Enum
from pydantic import BaseModel

class QueryClass(str, Enum):
    decision_lineage = "decision_lineage"
    contradiction_analysis = "contradiction_analysis"
    assumption_drift = "assumption_drift"
    next_action_guidance = "next_action_guidance"

class RouteDecision(BaseModel):
    query_class: QueryClass
    route_confidence: float
    route_rationale: str
```

```python
def classify_query(text: str) -> QueryClass:
    t = text.lower()
    if "contradict" in t or "conflict" in t:
        return QueryClass.contradiction_analysis
    if "assumption" in t or "drift" in t or "stale" in t:
        return QueryClass.assumption_drift
    if "next" in t or "what should we do" in t:
        return QueryClass.next_action_guidance
    return QueryClass.decision_lineage
```

## Integration notes
- Keep routing rules versioned and testable.
- Log route confidence, seed counts, and selected evidence counts in `query_run_trace`.
- When a query is broad, prefer routing to the more diagnostic class rather than the more generative one.

## Anti-patterns to avoid
- Dumping whole documents into the prompt.
- Letting the LLM decide the graph query surface from scratch.
- Applying permission filters only after context is assembled.
- Treating "next action" as generic advice rather than synthesis over unresolved graph state.

## Testing / validation steps
- One clear positive example per query class.
- Ambiguous prompts that force deterministic-vs-model fallback coverage.
- Snapshot test for context packet size and composition.
- Permission tests where hidden evidence changes the omission count but not the visible evidence payload.

## Performance considerations
- Routing should be cheap; the expensive budget belongs to evidence selection and analysis.
- Prefer indexed graph-local retrieval before FTS fan-out.
- Cache common seed lookups by normalized query object where safe.

## Security / privacy / licensing notes
- The route result must not leak that a hidden artifact exists.
- Omitted evidence should be described generically, never quoted or named.

## References
- Graphiti search recipes and graph-aware reranking
- Neo4j GraphRAG pre-filtering and result formatter hooks
- TrustGraph grounding, exploration, focus, synthesis trace pattern
