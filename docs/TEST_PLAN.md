# TEST_PLAN.md
## Testing and Evaluation Plan

## Test categories
- unit tests
- integration tests
- extraction quality tests
- reasoning quality tests
- permission tests
- UX sanity checks

## Evaluation set
Create a small gold set of internal-style artifacts with known:
- decisions,
- rationale,
- contradictions,
- stale assumptions,
- expected recommendations.

## Quality metrics
### Extraction
- precision / recall for decisions
- precision / recall for assumptions
- entity resolution usefulness

### Reasoning
- contradiction usefulness
- stale assumption usefulness
- recommendation usefulness
- evidence relevance

## Final test rule
If the system produces eloquent nonsense, it fails.
Correctness and evidence beat style.
