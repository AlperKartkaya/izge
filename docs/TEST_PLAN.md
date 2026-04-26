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
