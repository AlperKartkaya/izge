---
skill_id: compose_permission_aware_answers_and_audit
version: "1.1"
priority: "P0"
source_projects: ["TrustGraph", "Neo4j GraphRAG", "FastAPI", "OpenTelemetry"]
consumes: ["query_class", "analysis_context", "findings", "user_permissions"]
produces: ["query_result", "audit_events", "query_trace"]
depends_on: ["analyze_contradictions_and_assumption_drift"]
---

# Permission-Aware Answer Composition and Audit Logging

## Short description
Compose Izge answers from visible evidence only, preserve uncertainty and omission notes, and persist enough query-trace and audit data to explain how the answer was produced.

## Why this skill exists
The answer surface is where trust is either earned or destroyed. TrustGraph's strongest reusable idea is that explainability is not a debugging afterthought; it is a first-class product surface backed by real stored trace data. Neo4j GraphRAG adds the useful idea that raw records should be formatted into deliberate result packets. Izge needs both, plus strict permission discipline.

## Composition rules

### 1. Permission filter before composition
Visible evidence must already be filtered before the answer is built. Do not generate an unrestricted answer and then try to redact it afterward.

### 2. Evidence-backed sections only
Each major section of the answer should map to selected findings and evidence packets:
- `direct_answer`
- `why_this_answer`
- `supporting_evidence`
- `contradictions`
- `assumption_drift`
- `recommended_next_actions`
- `uncertainty`

### 3. Omission is explicit
If relevant evidence existed upstream but was removed due to permissions or coverage gaps, say so generically:
- hidden evidence count
- omitted artifact count
- parser coverage gaps
- extraction failures

Never reveal hidden titles, quotes, or document identifiers.

## Query trace to persist

### query_runs
- `query_run_id`
- `workspace_id`
- `actor_user_id`
- `query_text`
- `query_class`
- `route_confidence`
- `submitted_at`

### query_trace_steps
- `query_run_id`
- `step_kind`
- `payload_json`
- `created_at`

Suggested `step_kind` values:
- `route_decision`
- `seed_selection`
- `candidate_retrieval`
- `edge_exploration`
- `evidence_selection`
- `answer_composition`
- `uncertainty_note`

### audit_events
- `event_id`
- `workspace_id`
- `actor_user_id`
- `event_type`
- `target_type`
- `target_id`
- `timestamp`
- `event_metadata`

## Borrowed know-how by project

### From TrustGraph
- Keep a trace surface with explicit stages.
- Preserve provenance chains from answer back to source evidence.
- Treat omitted or partial evidence as a real part of the answer contract.

### From Neo4j GraphRAG
- Use a result-formatting layer to turn records into typed evidence packets.
- Keep machine-readable answer packets separate from UI rendering.

## Implementation blueprint

### Step 1. Filter the evidence set
From `analysis_context`, keep only evidence packets the actor is allowed to see.

### Step 2. Build a machine-readable answer packet
The answer packet should be stable enough to:
- render in the UI,
- export as JSON,
- and re-audit later

### Step 3. Persist trace data
Store route, candidates, selections, rejection reasons, omission counts, and uncertainty notes.

### Step 4. Emit audit events
At minimum:
- `query_submitted`
- `query_result_generated`
- optional `query_result_viewed`

## Minimal reproducible code snippets

```python
def compose_answer(query_class: str, findings: dict, visible_evidence: list[dict]) -> dict:
    answer = {
        "query_class": query_class,
        "direct_answer": findings["summary"],
        "why_this_answer": findings["reasoning_summary"],
        "supporting_evidence": visible_evidence,
        "contradictions": findings.get("contradictions", []),
        "assumption_drift": findings.get("assumption_drift", []),
        "recommended_next_actions": findings.get("next_actions", []),
        "uncertainty": findings.get("uncertainty", []),
    }
    if findings.get("hidden_evidence_count", 0):
        answer["uncertainty"].append(
            "Some potentially relevant evidence is not visible in this workspace or permission scope."
        )
    return answer
```

```sql
INSERT INTO audit_events (
  event_id, workspace_id, actor_user_id, event_type, target_type, target_id, timestamp, event_metadata
) VALUES (?, ?, ?, 'query_result_generated', 'query_run', ?, ?, ?);
```

## Integration notes
- FastAPI auth can establish identity, but artifact-level access must still be enforced in query code.
- Put omission counts and selected evidence IDs into trace tables so the UI can explain the answer without recomputing hidden state.
- Store the final answer packet separately from the rendered markdown or HTML.

## Anti-patterns to avoid
- Redacting after composition.
- Treating uncertainty as optional copywriting.
- Logging only the final answer with no evidence-selection trace.
- Caching unrestricted answers for later reuse in restricted contexts.

## Testing / validation steps
- Permission matrix test across admin, member, and restricted user roles.
- Assert that restricted evidence never appears in quotes, paraphrases, or recommendations.
- Assert that omission counts and uncertainty notes appear when hidden evidence or coverage gaps exist.
- Verify required audit events are present for successful and partially successful queries.

## Performance considerations
- Apply authorization at query time in SQL joins when possible.
- Persist trace steps incrementally instead of reconstructing the whole trace at the end.
- Avoid recomputing answer summaries when only presentational formatting changes.

## Security / privacy / licensing notes
- Hidden evidence is a leak vector even when only indirectly summarized.
- Do not log raw restricted text in audit tables.
- Token usage and tracing are useful, but store them without sensitive text bodies when possible.

## References
- TrustGraph explainability and provenance trace stages
- Neo4j GraphRAG result formatting and retrieval-stage separation
- FastAPI auth patterns and OpenTelemetry-style audit instrumentation
