# IMPLEMENTATION_ROADMAP.md
## Izge

## 1. Purpose
This roadmap translates the product strategy into a practical build sequence.

It is intentionally biased toward:
- constrained scope,
- product truth over feature count,
- trust and inspectability,
- demo-readiness,
- local-first credibility.

---

## 2. Guiding principles
- build one strong workflow first,
- keep the wedge on product/roadmap history,
- preserve local-first architecture,
- prefer grounded reasoning over eloquent output,
- support both reactive queries and proactive signal generation,
- let members contribute memory without turning the product into generic note software,
- avoid premature platform sprawl.

---

## 3. Milestones

### Milestone 1 — Foundation
Goal:
- backend/frontend scaffolding,
- auth,
- artifact submission,
- ingestion jobs,
- basic admin/member surfaces,
- local persistence.

Acceptance:
- a workspace exists,
- users can sign in,
- artifacts can be submitted,
- ingestion can run.

### Milestone 2 — Structured memory
Goal:
- extract the five required memory object types,
- store provenance and confidence,
- establish basic graph linkage.

Acceptance:
- artifacts produce memory objects,
- graph links exist,
- memory objects are inspectable.

### Milestone 3 — Core reasoning
Goal:
- implement the four reasoning modes,
- evidence-backed results,
- result-page structure.

Acceptance:
- decision lineage, contradiction, drift, and next-action queries work,
- results cite evidence,
- the result page feels product-native.

### Milestone 4 — Signals and proactive intelligence
Goal:
- evaluate newly submitted artifacts against existing memory,
- generate contradiction/drift/next-action signals,
- expose signals surfaces.

Acceptance:
- a conflicting new artifact can trigger useful proactive output,
- active contradictions/drift/next-actions are visible in workspace surfaces.

### Milestone 5 — Admin/member workflow coherence
Goal:
- make admin prepare/govern the memory,
- make members contribute and reason over it,
- tighten trust/governance and workspace state visibility.

Acceptance:
- admin can understand workspace readiness,
- members can submit logs/reports/notes,
- the product feels like one workflow.

### Milestone 6 — Demo hardening
Goal:
- support one clean canonical demo,
- improve inspectability,
- harden UX, copy, and symbolic continuity,
- reduce rough edges.

Acceptance:
- end-to-end demo runs cleanly,
- query-driven and proactive-ingestion scenarios both work,
- the product feels jury-ready.

---

## 4. Post-MVP direction
After the MVP:
- richer intake/review workflows,
- more sources and connectors,
- optional edge-side model participation,
- stronger continuity workflows,
- bounded scenario support.

## 5. Things to postpone
- broad integrations,
- enterprise SSO,
- OCR/audio/video ingestion,
- fully distributed edge inference,
- full scenario simulation,
- broad analytics/portal behavior,
- feature sprawl disguised as maturity.
