# DECISION_GRAPH_SPEC.md
## Izge Institutional Memory Graph

## Purpose
The graph is the core memory representation.

It represents:
- decisions,
- assumptions,
- constraints,
- outcomes,
- commitments,
- contradictions,
- drift signals,
- supersession/reopening,
- timelines,
- organizational topics and initiatives,
- related artifacts and evidence.

## Why a graph
Institutional memory is not linear.
A single decision may:
- appear in many artifacts,
- be grounded in several assumptions,
- be constrained by older commitments,
- be contradicted by later plans,
- be reopened by a new update,
- produce downstream outcomes and next-action implications.

## Core node types
- Artifact
- ArtifactChunk
- Decision
- Assumption
- Constraint
- Outcome
- Commitment
- Proposal (optional)
- Question (optional)
- Topic / Initiative
- Signal (optional logical representation for surfaced contradiction/drift/action items)

## Core edge types
- `MENTIONED_IN`
- `BASED_ON`
- `CONSTRAINED_BY`
- `RESULTED_IN`
- `RELATES_TO`
- `CONTRADICTS`
- `SUPERSEDES`

## Graph requirements
- every non-trivial reasoning output should be traceable to graph-linked evidence,
- graph relations must remain permission-aware,
- contradiction and drift should be modeled as explainable relational phenomena, not just text overlap,
- newly ingested artifacts should be evaluable against existing graph state,
- the graph should preserve continuity across recurring work such as intern handoffs, repeated initiatives, or reopened decisions.

## Design rule
The graph is not there to make the product look technical.
It exists so the system can reconstruct memory, detect tension, and justify next actions.
