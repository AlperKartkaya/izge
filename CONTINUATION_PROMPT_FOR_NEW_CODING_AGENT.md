# CONTINUATION PROMPT FOR NEW CODING AGENT

You are continuing implementation of **Izge**, not starting from scratch.

Your job is to take the repository from its **current real implementation state** to a **coherent, credible, eventually complete MVP** without drifting into the wrong category.

This prompt is your project handoff, implementation continuation brief, and category-discipline guide.

---

## 1. What Izge is

Izge is a **local-first institutional memory and decision intelligence system**.

Its purpose is to reconstruct what an organization decided, why it decided it, what assumptions and constraints shaped those decisions, what later contradicted or weakened them, and what the team should do next based on that history.

The current MVP wedge is **product and roadmap history**. That wedge is deliberate: it is the narrow, high-signal domain in which institutional memory failure is easy to show, commercially meaningful, and technically demonstrable.

Izge is **not**:

- internal search,
- chat over files,
- generic RAG,
- a PM copilot,
- a roadmap assistant,
- a broad analytics dashboard,
- a workflow tool,
- a simulation engine,
- or a fake multi-agent demo.

The long-term trajectory is:

1. **Institution Memory Engine** — the MVP center of gravity.
2. **Decision Guidance Layer** — partially visible already through next-action guidance.
3. **Bounded Scenario / Simulation Support** — future-facing only, explicitly out of scope now.

The biggest product danger is **category drift**. The implementation must keep feeling like **institutional memory first** and **decision intelligence second**. It must not slowly collapse into “search with nicer answers” or “chat over internal docs.”

---

## 2. Source of truth: read the locked docs first

Before making any implementation decision, read these files and treat them as the source of truth:

- `docs/MVP_IMPLEMENTATION_CONTRACT.md`
- `docs/PRE_INCUBATION_PRODUCT_BRIEF.md`
- `docs/VISION_AND_POSITIONING.md`
- `docs/MVP_SCOPE.md`
- `docs/SYSTEM_ARCHITECTURE.md`
- `docs/DECISION_GRAPH_SPEC.md`
- `docs/UI_UX_SPEC.md`
- `docs/DEMO_SCRIPT.md`

Do not rely on assumptions, generic product instincts, or common AI-app patterns before reading those files.

These docs define:

- the product identity,
- the anti-goals,
- the locked MVP scope,
- the wedge,
- the graph and memory model,
- the expected user experience,
- and the intended demo/jury story.

If implementation and the docs appear to conflict, treat the docs as the source of truth and resolve the discrepancy deliberately.

Make use of the skills under the folder skills/ when you dive into implementation regarding the concepts explained there. These skills are the building blocks of the system and better be followed for technical eork.


---

## 3. Do not assume blank-slate repo state

This repository is **not** at a blank scaffolding stage anymore.

Before acting, inspect the actual implementation first. In particular, inspect:

- the backend structure,
- the frontend structure,
- current services, routers, schemas, and models,
- current extraction and reasoning paths,
- current graph linkage logic,
- current evaluation assets,
- current contradiction/drift inspection surfaces,
- and current trust/inspection UX.

At minimum, inspect code under:

- `backend/app/`
- `frontend/src/`
- `backend/manual_eval/`

Important existing implementation areas include:

- `backend/app/services/ingestion.py`
- `backend/app/services/querying.py`
- `backend/app/routers/query.py`
- `backend/app/routers/analysis.py`
- `backend/app/routers/graph.py`
- `backend/app/routers/memory.py`
- `backend/app/models/domain.py`
- `backend/app/schemas/api.py`
- `frontend/src/pages/QueryResultPage.tsx`
- `frontend/src/pages/GraphPage.tsx`
- `frontend/src/pages/MemoryDetailPage.tsx`
- `frontend/src/auth/AuthContext.tsx`
- `backend/manual_eval/product_roadmap_seed/`
- `backend/manual_eval/run_seed_eval.py`

Do not treat the repo like a greenfield repo just because it began as a spec-heavy project.

---

## 4. Current implementation state: what has already been achieved

The repo already contains **real MVP implementation work**, not just shell code.

### Backend and frontend foundation already exist

The project already has:

- a **FastAPI backend**,
- a **React + TypeScript frontend**,
- **SQLite** persistence,
- **local filesystem** artifact storage,
- local-first architecture aligned to the contract,
- auth/session basics,
- artifact upload and pasted-text intake,
- ingestion triggers,
- query routes,
- graph summary and analysis routes,
- and a functioning multi-screen frontend shell.

### Structured memory extraction already exists in substance

The backend is already extracting the locked MVP memory object types:

- `Decision`
- `Assumption`
- `Constraint`
- `Outcome`
- `Commitment`

This is no longer placeholder-only scaffolding. Extraction persists structured records with evidence spans, confidence, timestamps, normalized text, and source artifact/chunk references.

### Explicit graph persistence and linkage already exist

The system already persists explicit:

- `graph_nodes`
- `graph_edges`

and already uses graph edges such as:

- `MENTIONED_IN`
- `BASED_ON`
- `RELATES_TO`
- `SUPERSEDES`
- `CONTRADICTS`

The graph is still evolving in quality, but it is real and central to the product behavior.

### Query-mode-specific reasoning already exists

The backend already supports the four locked query classes and does not present itself as generic chat:

- decision lineage,
- contradiction analysis,
- assumption drift,
- next-action guidance.

The system already returns structured result payloads with evidence-backed sections rather than a single vague answer blob.

### Evidence-first result rendering already exists

The frontend already renders:

- direct answer,
- why this answer,
- supporting evidence,
- related memory objects,
- contradictions/tensions,
- stale assumptions,
- recommended next actions,
- uncertainty.

This is an important product-strength signal. Preserve it.

### Trust and inspection work has already begun

The standalone contradiction and drift surfaces have already been improved substantially from their original thin fallback state. The system also already has inspection surfaces for:

- query result reasoning,
- graph summary and structural signals,
- per-memory detail,
- extracted artifact previews.

These surfaces are not complete, but they are not empty.

### There is already a seed dataset and lightweight eval harness

The repo already contains a compact product/roadmap seed pack and evaluation assets under:

- `backend/manual_eval/product_roadmap_seed/`
- `backend/manual_eval/run_seed_eval.py`

This is now part of the development workflow. Use it.

### The implementation has already been self-audited for category discipline

Recent work has explicitly tried to keep the product aligned to the intended category: institutional memory and decision intelligence, not search/chat drift.

Do not throw that discipline away by chasing broad features or generic AI-product patterns.

### Important caveat

Do **not** assume the MVP is complete.

The repo has meaningful implementation, but there are still weak spots, incomplete trust surfaces, areas of ranking/coherence that need improvement, and work left to make the MVP feel fully coherent and jury/demo ready.

You are continuing a serious build, not polishing a finished product.

---

## 5. How you should think while continuing

### Always reason about category direction

At every meaningful step, ask:

- Does this make Izge feel more like institutional memory?
- Does this make the product more like decision intelligence?
- Does this reduce drift toward chat/search/RAG/PM-copilot behavior?
- Does this strengthen the product’s wedge and demo story?

If a change improves engineering elegance but weakens product category clarity, it is the wrong change.

### Do not casually broaden scope

You are not here to invent a wider platform.

Do not casually add:

- integrations,
- new domains,
- new personas,
- broader ingestion types,
- speculative future-layer work,
- generic assistant features,
- workflow behavior,
- or simulation features.

The MVP gets stronger by becoming **more coherent**, not by becoming **wider**.

### Optimize for highest-leverage next steps

Do not execute a stale checklist blindly.

Instead:

1. inspect the current repo,
2. identify what is weak, inconsistent, incomplete, or category-risky,
3. decide the **highest-leverage next implementation pass**,
4. explain why that is the right next move,
5. then implement it.

### Periodically self-audit

Before and after significant work, briefly audit whether the product still feels like:

- institutional memory first,
- decision intelligence second,
- future scenario support only as trajectory,
- and clearly **not** chat-over-files or internal search.

Keep doing that throughout implementation.

---

## 6. What you should inspect in the implementation before choosing the next pass

Do not decide the next milestone from this prompt alone. Inspect the actual code and derive the next pass from the real repo state.

When inspecting, focus especially on:

### Backend reality

- extraction quality,
- normalization and coherence,
- graph linkage quality,
- contradiction ranking,
- drift detection,
- reasoning discipline,
- evidence provenance,
- uncertainty handling,
- analysis routes,
- trust consistency between query-driven and standalone inspection paths.

### Frontend reality

- whether the UI communicates institutional reasoning rather than chat,
- whether the result sections are clear and inspectable,
- whether contradiction/drift inspection is as strong as the main query path,
- whether the graph/timeline-related surfaces support the intended demo story,
- whether the product feels calm, analytical, and trustworthy.

### Evaluation reality

- whether the seed harness still gives meaningful signals,
- whether the expected outputs are still aligned to current implementation,
- whether reasoning changes can be sanity-checked quickly,
- whether demo/jury flows are improving or drifting.

---

## 7. How to choose the next best implementation pass

After inspecting the repo, choose the next pass using this logic:

### Prefer the highest-leverage weakness, not the easiest task

Good next passes usually improve one or more of:

- contradiction quality,
- historical coherence,
- evidence precision,
- trust/inspectability,
- query-mode distinctness,
- demo readiness,
- category discipline.

### Avoid surface-area temptation

Do not choose the next pass because it adds more visible product area.

Choose it because it makes the existing MVP:

- sharper,
- more coherent,
- more trustworthy,
- more clearly in-category,
- and more convincingly demoable.

### Explain why the pass is right

Before implementing, state briefly:

- what the current risk/weakness is,
- why it matters to product identity,
- why this pass is higher leverage than other possible work,
- and how you will verify it.

Then implement.

---

## 8. What “eventually complete the MVP” means in spirit

The end-state is not “the app has many pages.”

The end-state is an MVP that, in a coherent and credible way, does all of the following:

- ingests realistic product/roadmap artifacts,
- performs useful structured memory extraction,
- persists explicit graph-based institutional memory,
- supports strong mode-specific query behavior,
- returns evidence-backed answers,
- exposes inspectable contradictions and drift,
- preserves trust and provenance,
- stays clear in product category,
- reinforces the product/roadmap-history wedge,
- and is ready to support a convincing jury/demo story.

The MVP is complete when the product clearly demonstrates:

> “This system reconstructs decision history and helps teams make better decisions from that history.”

not:

> “This is another internal AI chat/search tool.”

---

## 9. Strong anti-pattern warnings

Avoid these aggressively.

### Category drift

Do not turn Izge into:

- chat-over-files,
- generic RAG,
- internal search,
- a PM copilot,
- a roadmap assistant,
- an analysis dashboard with AI sprinkled on top.

### Feature sprawl

Do not broaden prematurely into:

- new integrations,
- new domains,
- more file types,
- automation flows,
- simulations,
- collaboration/platform scope,
- or wide enterprise surface area.

### Future-layer leakage

Do not implement future scenario/simulation features just because the long-term trajectory exists.

That trajectory is strategic context, **not current scope**.

### Polishing the wrong things

Do not optimize primarily for:

- decorative visual polish,
- dashboards,
- page count,
- framework cleverness,
- architecture theater,
- or AI-sounding copy.

If the product’s reasoning is weak, more polish only makes the wrong thing prettier.

### Building the wrong shape

Do not build an internal tool that feels like:

- a query box with some side panels,
- an admin console for extracted objects,
- or a graph database browser.

Those may exist as supporting surfaces, but the product must still feel like a system that reconstructs memory and supports better present-day decisions.

---

## 10. Recommended execution discipline for continuation

When you start work in this repo:

1. Read the locked docs first.
2. Inspect the current backend/frontend/eval implementation.
3. Summarize the current state briefly.
4. State whether the product still feels on-category.
5. Identify the highest-leverage next pass from the actual repo state.
6. Explain why it is the right next move.
7. Implement narrowly.
8. Verify with:
   - diagnostics,
   - build,
   - endpoint/manual QA,
   - and the seed eval harness.
9. Re-audit whether the product moved closer to:
   - institutional memory,
   - decision intelligence,
   - wedge strength,
   - trust,
   - and demo readiness.

---

## 11. Final instruction

Continue Izge as a **disciplined institutional memory MVP**, not as a generic AI app.

Read the repo, understand the current implementation state, determine the best next pass from reality, explain why, and implement it in a way that keeps the product moving toward a coherent, evidence-backed, graph-based, demo-ready MVP.

Do not re-derive the product from scratch.
Do not broaden scope casually.
Do not let the category drift.

Build the next right thing.
