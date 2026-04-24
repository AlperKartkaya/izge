---
skill_id: analyze_contradictions_and_assumption_drift
version: "1.1"
priority: "P0"
source_projects: ["Graphiti", "TrustGraph", "Mem0", "ACL NLI research"]
consumes: ["analysis_context"]
produces: ["contradiction_edges", "drift_findings"]
depends_on: ["classify_queries_and_assemble_context"]
---

# Contradiction and Assumption-Drift Analysis

## Short description
Analyze semantically comparable claim occurrences over time, distinguish contradiction from supersession and simple scope mismatch, and return evidence-backed contradiction or drift findings with explicit uncertainty.

## Why this skill exists
Contradiction and drift are not search problems. They are comparison problems over typed claims with temporal ordering and provenance. The relevant lesson from the source systems is that good retrieval helps only if the comparison set is already narrowed to genuinely comparable claims.

## Core distinctions

### Contradiction
Two claims cannot both be true for the same subject, scope, and relevant time window.

### Supersession
A later claim replaces an earlier one as the current decision or plan, but the earlier claim may still have been true at the time.

### Scope mismatch
The claims differ in subject, scope, owner, or time window enough that they should not be marked contradictory.

### Drift
An earlier assumption becomes:
- `supported`
- `weakened`
- `reversed`
- `unresolved`

## Input expectations
- normalized object kinds
- `subject_key`
- `claim_family_key`
- explicit timestamps or temporal ordering
- paired evidence references

Do not attempt contradiction analysis over raw chunks alone.

## Borrowed know-how by project

### From Graphiti
- Compare within the same entity or relation family first.
- Separate duplicate detection from contradiction invalidation.
- Preserve older facts; invalidate or supersede them rather than deleting them.

### From TrustGraph
- Findings should be explainable as a chain from compared claim to selected evidence.
- The analysis should leave behind enough trace data to reconstruct why a pair was considered contradictory.

### From Mem0
- Treat contradiction as a dedicated reasoning stage; do not assume hybrid retrieval will solve it.
- Keep additive history so the system can reason about changes rather than only current state.

## Analysis blueprint

### Step 1. Generate candidates narrowly
Only compare claims that share:
- `claim_family_key`, or
- normalized subject plus comparable relation slot, or
- same commitment owner plus deliverable, or
- same metric target

Then narrow further by time relevance.

### Step 2. Build pair packets
For each candidate pair, construct:
- left claim text
- right claim text
- left evidence
- right evidence
- left and right timestamps
- family and scope metadata

### Step 3. Adjudicate relation type
The adjudicator should classify one of:
- `duplicate`
- `compatible`
- `contradicts`
- `supersedes`
- `different_scope`
- `insufficient_evidence`

This is better than a boolean contradiction flag because it forces scope discipline.

### Step 4. Apply temporal reasoning
Temporal logic matters:
- if the later claim updates the earlier plan, use `SUPERSEDES`
- if both claims overlap in validity and conflict, use `CONTRADICTS`
- if the later claim simply adds detail, keep both

This is the Graphiti-style invalidation lesson translated into Izge's decision domain.

### Step 5. Produce paired evidence
Every contradiction finding must include:
- the left evidence packet
- the right evidence packet
- comparison rationale
- confidence
- and uncertainty notes when context is partial

If one side lacks evidence, do not emit a contradiction edge.

## Drift analysis blueprint

### Seed
Start from an assumption object or assumption family.

### Traverse
Walk into later:
- decisions
- outcomes
- commitments
- incidents
- metrics

### Interpret
- `supported`: later evidence reinforces the assumption
- `weakened`: later evidence introduces pressure or exceptions
- `reversed`: later evidence clearly undermines it
- `unresolved`: there is not enough later evidence to judge

### Output
Each drift finding should include:
- `assumption_id`
- `status`
- `reason`
- `supporting_object_ids`
- `supporting_chunk_ids`
- `confidence`

## Minimal reproducible code snippets

```python
from pydantic import BaseModel
from typing import Literal

class DriftFinding(BaseModel):
    assumption_id: str
    status: Literal["supported", "weakened", "reversed", "unresolved"]
    reason: str
    evidence_chunk_ids: list[str]
    confidence: float
```

```python
def candidate_pairs(claims: list[dict]) -> list[tuple[dict, dict]]:
    pairs = []
    for left in claims:
        for right in claims:
            if left["id"] == right["id"]:
                continue
            if left["claim_family_key"] != right["claim_family_key"]:
                continue
            if left["observed_at"] and right["observed_at"]:
                if left["observed_at"] > right["observed_at"]:
                    continue
            pairs.append((left, right))
    return pairs
```

## Integration notes
- Persist contradiction and supersession edges separately.
- Keep adjudication rationale in trace storage, not only in the rendered answer.
- Record candidate-generation reasons so false positives can be debugged.

## Anti-patterns to avoid
- Contradiction detection by similarity search over the whole corpus.
- Comparing claims that only happen to share nouns.
- Treating "newer" as automatically contradictory.
- Emitting contradiction findings from one-sided evidence.

## Testing / validation steps
- Gold set for contradiction, supersession, and different-scope cases.
- Regression cases for negation, time shift, and same-topic-different-owner false positives.
- Drift fixtures where an assumption is first supported, then later reversed.

## Performance considerations
- Pairwise comparison explodes quickly; cap candidate sets by family and time window before model adjudication.
- Cache normalized claim families and candidate lists for repeated query runs.

## Security / privacy / licensing notes
- Do not construct paired findings if one side depends on hidden evidence the user cannot access.
- If hidden evidence affected ranking but was excluded before analysis, surface reduced-confidence language instead of fabricated certainty.

## References
- Graphiti duplicate-versus-invalidation edge resolution
- TrustGraph traceable evidence pairing
- Mem0 warning that contradiction resolution needs its own stage
