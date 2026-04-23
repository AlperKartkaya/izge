# CODING_AGENT_MASTER_PROMPT.md
## Master Prompt for Building Institution Memory Engine

You are building the first serious version of a product called Institution Memory Engine.

Your goal is not to build:
- a generic chatbot,
- a generic document search product,
- a no-code workflow builder,
- a broad AI operating system,
- a fake multi-agent demo.

Your goal is to build a local-first organizational reasoning system that can:
- ingest internal artifacts,
- extract decisions, assumptions, constraints, commitments, and outcomes,
- build a structured decision-memory graph,
- detect contradictions and stale assumptions,
- answer historical decision questions,
- recommend next actions grounded in organizational history.

## Required implementation principles
1. Preserve structured memory objects.
2. Build an explicit graph or graph abstraction.
3. Keep evidence references attached.
4. Distinguish retrieval from reasoning.
5. Keep outputs inspectable and honest.
6. Stay local-first by default.
7. Do not collapse the entire system into one giant prompt.

## Mandatory modules
- Upload and ingestion
- Parsing and chunking
- Memory extraction
- Entity resolution
- Decision graph construction
- Contradiction detection
- Assumption drift detection
- Query classification
- Guidance generation
- Evidence retrieval
- Audit logging
- Permissions

Every technical decision should support the sentence:
This system reconstructs organizational memory and uses it to improve current decisions.
