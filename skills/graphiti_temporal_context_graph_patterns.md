---
skill_id: graphiti_temporal_context_graph_patterns
version: "1.0"
priority: "P0"
source_projects: ["Graphiti", "Zep"]
consumes: ["project_research", "repo_patterns"]
produces: ["temporal_graph_patterns", "invalidation_rules", "retrieval_recipes"]
depends_on: []
---

# Graphiti Temporal Context Graph Patterns

## Short description
Capture the reusable Graphiti patterns that matter for Izge: immutable source events, temporal claim validity, duplicate-versus-contradiction resolution, and explicit hybrid retrieval recipes.

## What Graphiti is actually good at
Graphiti is not useful to Izge because it is "an agent memory product." It is useful because it operationalizes four habits that most local memory systems get wrong:

- source events are immutable,
- facts have validity windows,
- duplicate detection is separated from contradiction invalidation,
- and search is expressed as explicit recipes rather than vague "graph search."

Those habits transfer well to decision intelligence.

## Pattern 1. Use immutable source events

### Graphiti's model
Graphiti stores raw ingested material as episodes and treats entities and edges as derived from those episodes. Everything points back to source episodes.

### Translation for Izge
Treat:
- artifact blobs,
- artifact chunks,
- and claim occurrences

as immutable evidence-bearing events. Never overwrite the original evidence row because a newer interpretation exists.

### Practical rule
If a roadmap changed, Izge should store:
- the old decision occurrence,
- the new decision occurrence,
- and the edge that says the new one supersedes or contradicts the old one.

Do not collapse them into a single "current state" row.

## Pattern 2. Preserve validity windows

### Graphiti's model
Entity edges carry `valid_at`, `invalid_at`, and `expired_at`. Facts are invalidated, not deleted.

### Translation for Izge
Every claim occurrence or comparable edge family should support:
- `valid_from`
- `valid_to`
- `superseded_by`
- `expired_at`

This is especially important for:
- assumptions that stop holding,
- commitments that are replaced,
- decisions that are reopened,
- and constraints that expire.

## Pattern 3. Separate duplicate detection from contradiction invalidation

Graphiti's `resolve_extracted_edge` flow is worth copying almost literally at the strategy level.

### The flow
1. Fast-path exact duplicates by checking:
   - same source node
   - same target node
   - normalized fact text
2. Fetch duplicate candidates only from edges between the same node pair.
3. Fetch broader invalidation candidates separately.
4. Ask a small model to classify:
   - duplicate facts
   - contradicted facts
5. Reuse the old edge if it is a duplicate.
6. Extract timestamps for the new edge if it survives as new.
7. Expire older contradictory edges only when the temporal logic actually overlaps.

### Why this matters
Most contradiction systems skip steps 1 to 3 and ask the model whether two vaguely similar texts conflict. Graphiti shows that the quality comes from narrowing first, then adjudicating.

### Translation for Izge
For decisions, assumptions, and commitments:
- narrow by `claim_family_key`
- compare exact or near duplicates before contradiction
- and keep separate candidate pools for duplicate reuse versus invalidation

## Pattern 4. Use small explicit search recipes

Graphiti exposes recipe-like search configs such as:
- BM25 plus cosine plus BFS
- RRF reranking
- MMR reranking
- cross-encoder reranking
- node-distance reranking
- episode-mentions reranking

### Why this matters
This is a clean alternative to "let the LLM invent the retrieval strategy."

### Translation for Izge
Define a few fixed recipes:
- lexical plus semantic seeding for candidate claims
- graph-distance reranking for lineage expansion
- evidence-pair reranking for contradiction analysis

Do not expose open-ended graph query generation as a core product surface.

## Pattern 5. Chunk dense inputs differently from normal prose

Graphiti's dense-vs-normal ingestion example is valuable because it encodes a practical rule:

- prose and meetings can often be processed in one pass,
- entity-dense structured content needs automatic chunking with overlap.

The example uses thresholds such as:
- minimum tokens before chunking
- entity density threshold
- chunk token size
- overlap tokens

### Translation for Izge
Use different chunking heuristics for:
- prose planning docs,
- specs,
- dense metric or cost tables,
- structured decision logs

Otherwise extraction quality will collapse first on dense artifacts.

## Pattern 6. Attribute multi-episode facts explicitly

Graphiti's extraction instructions include `episode_indices` when facts come from multiple concatenated episodes.

### Why this matters
When several nearby evidence units are combined for extraction, the system should still know which unit actually supported the resulting fact.

### Translation for Izge
When extraction uses:
- current chunk
- previous chunk
- next chunk

record which chunks actually contributed. Do not pretend every local-context chunk is equal evidence.

## Pattern 7. Bulk import is not the same as fully reconciled history

Graphiti's bulk utilities explicitly note that, for now, edge invalidation is not tracked in the bulk dedupe path.

### Direct lesson
Fast historical backfill and complete historical reconciliation are different jobs.

### Translation for Izge
If you bulk-load old artifacts:
1. write occurrences and initial links quickly
2. run a later reconciliation pass for:
   - supersession
   - contradiction
   - duplicate compression

Do not claim historical integrity until step 2 is done.

## Concrete implementation rules for Izge

### Do copy
- additive claim storage
- validity windows
- duplicate-first contradiction logic
- retrieval recipes
- dense-input chunking heuristics
- multi-source attribution

### Do not copy
- users, threads, and general agent-memory abstractions
- broad community-summary retrieval as a product feature
- category drift toward general AI memory infrastructure

## Minimal pseudo-code pattern

```python
def resolve_claim(new_claim, duplicate_candidates, invalidation_candidates):
    exact = find_exact_duplicate(new_claim, duplicate_candidates)
    if exact:
        return exact, []

    verdict = adjudicate_duplicate_or_conflict(
        new_claim,
        duplicate_candidates,
        invalidation_candidates,
    )

    resolved = new_claim
    invalidated = []

    if verdict.duplicate_ids:
        resolved = duplicate_candidates[verdict.duplicate_ids[0]]
    else:
        resolved = enrich_with_timestamps(resolved)
        invalidated = expire_overlapping_conflicts(resolved, verdict.conflicted_edges)

    return resolved, invalidated
```

## Anti-patterns to avoid
- Global contradiction search over the whole graph.
- Overwriting old decisions when new ones arrive.
- Treating dense tables like narrative prose.
- Considering bulk backfill complete before reconciliation.

## References
- Graphiti README
- Graphiti `search_config_recipes.py`
- Graphiti `edge_operations.py`
- Graphiti bulk utilities and dense-vs-normal ingestion example
