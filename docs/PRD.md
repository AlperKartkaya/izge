# PRD.md
## Product Requirements Document
## Izge

## 1. Product overview
Izge is a **local-first institutional memory and decision intelligence system**.

It helps organizations reconstruct what was decided, why it was decided, what assumptions and constraints shaped those decisions, what later contradicted them, what has drifted, and what teams should do next.

Izge is not:
- internal search,
- chat over files,
- a PM copilot,
- a generic agent-memory framework,
- or generic AI SaaS.

## 2. Problem statement
Organizations do not simply lack information. They lack continuity.

Important context gets scattered across roadmap docs, planning notes, weekly updates, reports, presentations, postmortems, and ad hoc decisions. New proposals conflict with old commitments. Assumptions continue shaping work after they have become stale. New people repeat work that has already been done because the memory of that work is not structurally available.

## 3. Users
### Primary users
- product and strategy teams
- admins / workspace owners
- members contributing and querying organizational memory

### Secondary users
- managers reviewing tensions and next actions
- recurring contributors such as interns, analysts, or rotating project roles

## 4. Core use cases
1. Ask why a prior decision was made.
2. Detect whether a current plan contradicts prior history.
3. Detect whether an assumption has drifted.
4. Receive grounded next-action guidance.
5. Submit a new artifact and immediately detect contradiction/drift/supersession.
6. Surface active contradictions, drift, and next actions across the workspace.
7. Avoid repeated work by surfacing prior relevant reports or decisions.

## 5. Goals
- reconstruct decision history from internal artifacts,
- make contradiction and drift visible,
- produce evidence-backed next-action guidance,
- operate local-first on company-controlled infrastructure,
- support both admin stewardship and member reasoning,
- enable a clean demo-ready workflow.

## 6. Non-goals
- generic enterprise search,
- generic chatbot behavior,
- broad workflow automation platform,
- every enterprise integration,
- full scenario simulation in MVP,
- mandatory distributed edge inference in MVP.

## 7. Functional requirements
### Workspace and access
- The system shall support Admin and Member roles.
- The system shall enforce artifact/evidence/output-level permissions.

### Local-first processing
- The system shall use company-controlled infrastructure for storage and primary reasoning.
- The system shall support a central inference node for heavy reasoning tasks.
- The system should allow future lightweight edge-side reasoning with smaller local models.

### Intake and ingestion
- The system shall support Markdown, plain text, PDF, and pasted text.
- The system shall allow member contribution of logs, reports, notes, and presentation summaries.
- The system shall parse, chunk, and ingest artifacts locally.

### Memory extraction
- The system shall extract Decision, Assumption, Constraint, Outcome, and Commitment objects.
- The system shall preserve evidence spans, provenance, confidence, and inferred timestamps.

### Graph and reasoning
- The system shall build explicit graph relationships between memory objects.
- The system shall support decision lineage, contradiction analysis, assumption drift, and next-action guidance.

### Proactive detection
- The system shall evaluate newly ingested artifacts against existing memory.
- The system shall detect contradiction, drift, and supersession when justified by evidence.
- The system shall generate grounded next-action suggestions on meaningful new tension.

### Signals surfaces
- The system shall expose active contradictions, assumption drift, and next actions.
- The system should show urgency and uncertainty indicators for surfaced signals.

### Continuity
- The system should surface prior relevant work when new work overlaps with earlier work.
- The system should support anti-duplication continuity use cases such as intern handoff memory.

## 8. Non-functional requirements
- The system shall preserve its category as institutional memory + decision intelligence.
- The system shall remain structured, inspectable, and evidence-backed.
- The system shall operate local-first for MVP.
- The system shall remain usable for non-technical professionals.
- The system shall make uncertainty visible.
- The system shall avoid hallucinated or weakly justified contradictions/guidance.
- The system should remain modular and extensible.
- The system should be responsive enough for a smooth MVP demo.
- The system should feel like a real product rather than disconnected prototype pages.

## 9. Success criteria
The MVP is successful when:
- an admin can prepare a workspace with real artifacts,
- members can contribute and query organizational memory,
- a user can ask a real question and receive evidence-backed reasoning,
- a newly submitted conflicting artifact can trigger contradiction/drift/guidance,
- a jury can understand the product category and trust the workflow.

## 10. Primary demo scenarios
### Scenario A — Query-driven
A user asks why a product/roadmap decision was made, what changed, and what should happen next.

### Scenario B — Proactive ingestion
A new artifact is submitted and the system immediately detects contradiction or drift, then suggests a grounded next action.

### Scenario C — Continuity / anti-duplication
A prior report or intern artifact is surfaced so repeated work is avoided.
