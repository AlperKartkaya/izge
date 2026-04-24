# Demo Scenario Wiring Spec

This file explains exactly where the demo data will be wired in the current repo and UI.

## Primary demo flow: UI upload

Use this when we are preparing the live MVP walkthrough.

### Inputs

Provide these Markdown files, filled according to `docs/demo/DATA_SPEC.md`:

1. `01_<topic>_baseline_decision.md`
2. `02_<topic>_evidence_review.md`
3. `03_<topic>_reversal_or_conflict.md`
4. `04_<topic>_checkpoint.md`
5. Optional: `05_<topic>_restricted_note.md`

### Upload destination

Current UI destination:

- Frontend route: `/artifacts`
- Backend endpoint used by UI: `POST /api/artifacts/upload`
- Frontend API function: `uploadArtifact` in `frontend/src/lib/api.ts`

### Upload settings

For files `01` through `04`:

- Visibility: `workspace`
- Title: use the H1 title from the file, or a clear title matching the filename.
- Upload order: chronological filename order, `01` first through `04` last.

For optional file `05`:

- Visibility: `restricted`
- Permitted users: Admin only, unless we intentionally want a named member to see it.
- Purpose: demonstrate that restricted evidence is hidden from member result payloads and trace details.

### Ingestion destination

After each upload, run ingestion.

- UI route: `/ingestion`
- Backend endpoint: `POST /api/ingestion/run`
- Frontend API function: `runIngestion` in `frontend/src/lib/api.ts`

### Demo questions

Ask these questions from the Query screen after ingestion finishes.

- Decision lineage: `What was decided about <TOPIC_PHRASE> and why?`
- Contradiction analysis: `Which roadmap decisions now contradict earlier commitments on <TOPIC_PHRASE>?`
- Assumption drift: `Which assumptions about <TOPIC_PHRASE> now look stale?`
- Next-action guidance: `What should the team do next about <TOPIC_PHRASE>?`

Replace `<TOPIC_PHRASE>` with the exact repeated phrase from the artifacts.

### Expected UI surfaces

The demo should show:

- Direct Answer
- Why This Answer
- Key Historical Evidence
- Related Memory Objects
- Contradictions / Tensions
- Assumption Drift
- Recommended Next Actions
- Uncertainty or Missing Context
- Inspectable reasoning path
- Graph/timeline view at `/graph`
- Memory detail pages under `/memory/:memoryType/:memoryId`

## Repeatable demo eval flow: seed corpus wiring

Use this when we want the scenario to be validated by one command.

### File destination

Copy the final four required files here:

```text
backend/manual_eval/product_roadmap_seed/
```

Required naming pattern:

```text
01_<topic>_baseline_decision.md
02_<topic>_evidence_review.md
03_<topic>_reversal_or_conflict.md
04_<topic>_checkpoint.md
```

Why this naming matters:

- `backend/manual_eval/run_seed_eval.py` uploads files matching `0*.md` from `backend/manual_eval/product_roadmap_seed/`.
- It sorts them lexically, so `01` through `04` define upload order.
- It derives default artifact titles from filename stems when uploading through the harness.

### Manifest update

Update:

```text
backend/manual_eval/product_roadmap_seed/MANIFEST.md
```

Include:

- upload order,
- one-sentence scenario summary,
- the four exact demo questions,
- any optional restricted-artifact note.

### Expected signal update

Update:

```text
backend/manual_eval/product_roadmap_seed/expected_signals.json
```

The JSON must keep this structure:

```json
{
  "queries": [
    {
      "name": "lineage",
      "query": "What was decided about <TOPIC_PHRASE> and why?",
      "expected_query_class": "Decision lineage",
      "expected_answer_contains": ["<earlier target>", "<later target>"],
      "expected_supporting_memory_types": ["decision"]
    },
    {
      "name": "contradiction",
      "query": "Which roadmap decisions now contradict earlier commitments on <TOPIC_PHRASE>?",
      "expected_query_class": "Contradiction analysis",
      "expected_top_relation_types": [["decision", "decision"], ["decision", "commitment"]],
      "expected_topic_key": "<topic tokens>",
      "expected_top_evidence_contains": ["<later conflict fragment>"],
      "expected_top_provenance_contains": ["<later artifact title>", "later-vs-earlier conflict"],
      "expected_top_from_evidence_contains": ["<later conflict fragment>"],
      "expected_top_to_evidence_contains": ["<earlier baseline fragment>"],
      "expected_top_from_artifact_title": "<title derived from 03 filename>",
      "expected_top_to_artifact_title": "<title derived from 01 filename>"
    },
    {
      "name": "assumption_drift",
      "query": "Which assumptions about <TOPIC_PHRASE> now look stale?",
      "expected_query_class": "Assumption drift",
      "expected_statuses": ["stale", "reversed"],
      "expected_top_evidence_contains": ["<metric changed>", "<negative outcome>"],
      "expected_top_provenance_contains": ["<evidence artifact title>", "Direct later-signal excerpt"]
    },
    {
      "name": "next_action",
      "query": "What should the team do next about <TOPIC_PHRASE>?",
      "expected_query_class": "Next-action guidance",
      "expected_actions_contains": ["Resolve the conflict", "Revalidate the assumption", "Review the open commitment"],
      "expected_supporting_memory_types": ["commitment"],
      "expected_supporting_commitment_due_dates": ["YYYY-MM-DD"]
    }
  ]
}
```

### Verification command

Run:

```bash
cd backend
.venv/bin/python -m manual_eval.run_isolated_seed_eval
```

Pass condition:

- `summary.failed_checks` is `0`.
- The command exits with status `0`.

## Pasted-text alternative

If you cannot provide files, paste the exact same Markdown body into the Artifacts pasted-text form.

Current UI destination:

- Frontend route: `/artifacts`
- Backend endpoint used by UI: `POST /api/artifacts/pasted-text`
- Frontend API function: `createPastedText` in `frontend/src/lib/api.ts`

Use the same title/date/heading/body format from `docs/demo/DATA_SPEC.md`.
