---
skill_id: trustgraph_provenance_trace_patterns
version: "1.0"
priority: "P0"
source_projects: ["TrustGraph"]
consumes: ["project_research", "repo_patterns"]
produces: ["provenance_patterns", "query_trace_patterns", "explainability_patterns"]
depends_on: []
---

# TrustGraph Provenance and Trace Patterns

## Short description
Capture the TrustGraph patterns that matter for Izge: separate provenance layers, staged query traces, answer-to-source traversal, and subgraph-based extraction provenance rather than per-fact reification.

## What TrustGraph is actually good at
TrustGraph is broader than Izge and should not be copied as a platform. But it is unusually good at one thing Izge absolutely needs: making provenance and explainability concrete data structures instead of after-the-fact prose.

The core transferable idea is to keep three different things separate:
- knowledge graph state
- extraction provenance
- query-time reasoning trace

## Pattern 1. Query-time explainability has explicit stages

TrustGraph models GraphRAG traces as:

```text
Question -> Grounding -> Exploration -> Focus -> Synthesis
```

It models agent flows similarly with explicit analysis and observation steps.

### Why this matters
Users can inspect not just the final answer, but:
- how the query was interpreted,
- what was explored,
- what was selected,
- and what was finally synthesized

### Translation for Izge
Persist query traces with stages such as:
- route decision
- seed selection
- edge exploration
- evidence selection
- answer synthesis

This should be real stored data, not regenerated commentary.

## Pattern 2. Use explicit provenance chains

TrustGraph's CLI can trace an answer-selected edge back through:
- retrieval provenance
- source subgraph
- chunk
- page
- document

### Translation for Izge
Every selected contradiction edge or decision lineage step should be traceable back to:
- object evidence
- chunk
- artifact

The system should be able to render:

```text
Answer section -> selected object/edge -> evidence chunk -> artifact
```

without prompt-time reconstruction.

## Pattern 3. Use one extraction provenance record per chunk extraction

TrustGraph's extraction-provenance subgraph design is especially valuable. It replaces per-triple provenance with one subgraph provenance record per chunk extraction.

### The reason
If one chunk extraction creates 20 relationships, creating 20 separate provenance activities is both wasteful and misleading. The system actually performed one extraction event that yielded many derived triples.

### The new structure
- one `subgraph_uri`
- many `tg:contains` links to the extracted triples
- one `prov:wasDerivedFrom` link to the source chunk
- one `prov:wasGeneratedBy` activity
- one agent/component record

### Translation for Izge
For each extraction run over a chunk, store:
- one extraction run row
- many object or edge evidence rows tied to that run

Do not create a fake independent extraction event per object if the system generated them together.

## Pattern 4. Use named layers, not overloaded rows

TrustGraph distinguishes:
- `urn:graph:source`
- `urn:graph:retrieval`

### Translation for Izge
You do not need RDF named graphs, but you do need separate tables or logical layers for:
- extraction provenance
- query trace
- graph state

Do not make `graph_edges` double as query-debug storage.

## Pattern 5. Record reasoning metadata, not just selected items

TrustGraph records details such as:
- concepts extracted at grounding
- edge counts at exploration
- reasoning tied to focused edge selections
- token counts and model identifiers at synthesis

### Translation for Izge
Persist:
- route rationale
- selected evidence reasons
- rejected-candidate reasons where important
- omission counts
- uncertainty notes

This makes later debugging and trust inspection possible.

## Pattern 6. Build trace viewers, not only trace storage

TrustGraph's `show_explain_trace` CLI does several useful things:
- resolves labels
- groups trace stages
- prints selected edges
- optionally walks provenance chains to sources

### Translation for Izge
Any trace storage design should be paired with:
- an API contract for trace inspection
- and a UI surface that can actually show the stages

If trace data is stored but never rendered, it will rot.

## Concrete implementation rules for Izge

### Do copy
- explicit staged query traces
- answer-to-source traversal
- one extraction provenance record per chunk run
- separate layers for graph state and provenance

### Do not copy
- the broader "context development platform" ambition
- microservice and flow-orchestration sprawl
- multi-agent or MCP platform scope

## Minimal pseudo-code pattern

```python
query_trace = {
    "question": query_text,
    "grounding": {"route": query_class, "seeds": seed_ids},
    "exploration": {"edges_considered": candidate_edge_ids},
    "focus": {"selected_edges": selected_edge_ids},
    "synthesis": {"answer_sections": section_ids},
}
```

```python
extraction_run = {
    "run_id": run_id,
    "chunk_id": chunk_id,
    "component_name": "memory_object_extractor",
    "component_version": extractor_version,
}

for object_id in extracted_object_ids:
    link_run_to_object_evidence(run_id, object_id, chunk_id)
```

## Anti-patterns to avoid
- Logging only the final answer text.
- One provenance blob per node or edge with no traversal semantics.
- Reifying every extracted fact as a separate extraction event when they came from one chunk-level run.
- Building a trace system that cannot resolve back to source chunks.

## References
- TrustGraph `agent-explainability.md`
- TrustGraph `extraction-provenance-subgraph.md`
- TrustGraph explainability demo and trace CLI
