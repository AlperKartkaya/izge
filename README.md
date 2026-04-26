# Izge

Izge is a **local-first institutional memory and decision intelligence system**.

It is focused on reconstructing what an organization decided, why it decided it, what assumptions and constraints shaped those decisions, what later contradicted them, what has drifted, and what teams should do next.

It is not:
- internal search,
- chat over files,
- generic RAG,
- a PM copilot,
- or generic AI SaaS.

## Current product direction
Izge combines:
- structured memory extraction,
- explicit graph modeling,
- contradiction analysis,
- assumption drift detection,
- next-action guidance,
- proactive evaluation of newly submitted artifacts,
- signals surfaces for active contradictions, drift, and next actions.

The MVP wedge is **product and roadmap history**, while remaining capable of supporting continuity cases such as intern report handoff and repeated-work avoidance.

## Local-first meaning
For the MVP, local-first means:
- artifacts are stored inside company-controlled infrastructure,
- heavy reasoning runs on a central company-controlled inference node,
- external hosted AI is not the primary reasoning layer,
- future optional edge-side smaller-model participation is possible but not required for MVP.

## Core user roles
- **Admin**: prepares, governs, and inspects the memory
- **Member**: contributes artifacts and reasons over the reconstructed memory

## Core product scenarios
1. Query-driven reasoning:
   ask why a decision was made, what changed, what conflicts, and what should happen next.
2. Proactive ingestion:
   submit a new conflicting artifact and immediately detect contradiction/drift with grounded next-action guidance.
3. Continuity:
   surface prior relevant work so repeated work is avoided.

## Repository structure
- `backend/` — FastAPI backend, ingestion pipeline, structured memory extraction, graph persistence, reasoning routes, and manual evaluation assets.
- `frontend/` — React + TypeScript frontend with the current MVP product surfaces.
- `docs/` — product, architecture, scope, and implementation specifications where applicable.

## Design rule
If a change makes Izge feel more like generic search, generic chat, or generic AI tooling, it is probably the wrong change.
