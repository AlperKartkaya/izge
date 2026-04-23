# Product / Roadmap Seed Pack

This compact internal-style dataset is designed for manual MVP evaluation through the existing Izge product flow.

## Upload order

1. `01_strategy_reset.md`
2. `02_capacity_review.md`
3. `03_launch_reversal.md`
4. `04_exec_checkpoint.md`

## Intended evaluation questions

- Decision lineage: `What was decided about self-serve onboarding and why?`
- Contradiction analysis: `Which roadmap decisions now contradict earlier commitments on self-serve onboarding?`
- Assumption drift: `Which assumptions about manual onboarding support now look stale?`
- Next-action guidance: `What should the team do next about the onboarding launch plan?`

## Manual flow

Upload these files through the Artifacts screen or `POST /api/artifacts/upload`, run ingestion for each artifact, then evaluate through `/api/query`.
