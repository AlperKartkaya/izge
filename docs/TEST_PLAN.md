# TEST_PLAN.md
## Testing and Evaluation Plan

## Test categories
- unit tests
- integration tests
- extraction quality tests
- reasoning quality tests
- proactive detection tests
- permission tests
- UX sanity checks
- demo-flow tests

## Evaluation set
Create a small gold set of internal-style artifacts with known:
- decisions,
- rationale,
- contradictions,
- assumption drift,
- supersession/reopening,
- expected recommendations,
- at least one continuity / anti-duplication case.

## Quality metrics
### Extraction
- precision / recall for decisions
- precision / recall for assumptions
- usefulness of topic normalization
- evidence span quality

### Reasoning
- contradiction usefulness
- assumption drift usefulness
- recommendation usefulness
- evidence relevance
- uncertainty appropriateness

### Proactive detection
- does a new conflicting artifact trigger the right contradiction/drift signal?
- is the suggested next action grounded?
- are weak/spurious conflicts suppressed?

### Permissions
- restricted evidence must not leak,
- derived outputs must remain permission-aware.

### UX / workflow
- admin can understand workspace readiness,
- member can contribute artifacts,
- query flow is coherent,
- signals surface is legible,
- evidence drill-down works.

## Demo test
The product should support:
1. a query-driven demo,
2. a proactive conflicting-artifact demo,
3. optionally a continuity/anti-duplication demo.

## Final test rule
If the system produces eloquent nonsense, weakly justified contradictions, or uninspectable recommendations, it fails.

## Synthetic company workflow gate

Use the Northstar Payroll one-company corpus to test real-world workflow readiness beyond endpoint shape checks:

```bash
cd backend
.venv/bin/python -m manual_eval.run_isolated_synthetic_company_workflow
```

This gate verifies: artifact ingestion, meaningful query answers for lineage/contradiction/drift/next action, memory file-system organization, temporal KG projection, bounded scenario replay, prompt-injection boundary, member redaction of restricted evidence, rejected-artifact exclusion, target readiness reflection, and DB-backed orchestration job enqueue/claim/complete behavior.

## Migration/version gate

Before schema-affecting changes or Docker/customer handoff, run:

```bash
scripts/db-migrate.sh
scripts/db-check.sh
```

Fresh databases must upgrade to the current Alembic head. Verified pre-Alembic SQLite databases can be stamped through `scripts/db-stamp-current.sh` after the compatibility checker passes.
