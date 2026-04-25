# Institution Memory Engine Docs

This document set began as the build handoff for the first serious version of the product.

The repository now also contains active backend and frontend implementation work, but these documents remain the source of truth for product intent, scope, architecture, UX, and anti-drift guardrails.

## Product in one sentence

A local-first system that reconstructs organizational decision history, detects contradictions and stale assumptions, and recommends better next actions based on institutional memory.

## Source-of-truth docs

Keep these files at the root of `docs/` because project prompts and repo guidance reference these exact paths.

### Product and scope

- `VISION_AND_POSITIONING.md`
- `PRE_INCUBATION_PRODUCT_BRIEF.md`
- `PRD.md`
- `MVP_SCOPE.md`
- `MVP_IMPLEMENTATION_CONTRACT.md`

### Architecture and domain model

- `SYSTEM_ARCHITECTURE.md`
- `DOMAIN_MODEL.md`
- `DECISION_GRAPH_SPEC.md`
- `API_SPEC.md`
- `SECURITY_GOVERNANCE.md`
- `DEPLOYMENT_MVP.md`

### UX, evaluation, and implementation

- `UI_UX_SPEC.md`
- `IMPLEMENTATION_ROADMAP.md`
- `TEST_PLAN.md`
- `DEMO_SCRIPT.md`
- `AGENT_REGISTRY.md`
- `PROMPTING_AND_REASONING_SPEC.md`
- `CODING_AGENT_MASTER_PROMPT.md`
- `SKILL.md`

## Demo readiness docs

Demo-specific materials are grouped under `docs/demo/`:

- `demo/README.md` — start here for demo prep.
- `demo/DATA_SPEC.md` — exact data requirements and parser-compatible Markdown format.
- `demo/SCENARIO_WIRING.md` — how the data wires into the UI and isolated eval.
- `demo/data/` — current self-serve onboarding launch demo packet.
- `demo/templates/` — copyable templates for future demo scenarios.

## Product warning

This product must not drift into:

- generic enterprise search,
- generic chat over documents,
- vague knowledge management,
- no-code workflow builder,
- fake multi-agent theater.

Its value comes from:

- decision extraction,
- memory reconstruction,
- contradiction detection,
- decision lineage,
- stale-assumption detection,
- forward guidance grounded in actual organizational history.
