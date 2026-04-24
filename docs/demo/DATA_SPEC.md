# Demo Data Specification

This file states exactly what data is needed for the MVP demo and the format it must use to work with the current Izge ingestion, graph-linking, query, and manual-evaluation paths.

## What I need from you

Gather a small, sanitized product/roadmap-history packet around **one coherent decision thread**. The packet should show that a team made a decision, operated under assumptions/constraints, later observed evidence that weakened those assumptions, then faced a conflicting/revised decision and had to choose what to do next.

Use either real internal history that is safe to demo or realistic anonymized history. The data does **not** need to be long; quality and clarity matter more than volume.

## Required packet

Minimum packet: **4 Markdown artifacts**.

| File | Artifact role | What it must prove | Required memory objects |
| --- | --- | --- | --- |
| `01_<topic>_baseline_decision.md` | Baseline decision | The original decision and why the team chose it | 1 Decision, 1 Assumption, 1 Constraint, 1 Commitment |
| `02_<topic>_evidence_review.md` | Later evidence / pressure | Reality changed or the assumption weakened | 1 Outcome, 1 Constraint, 1 Assumption |
| `03_<topic>_reversal_or_conflict.md` | Conflicting/revised decision | A later decision conflicts with or supersedes the original | 1 Decision, 1 Assumption, 1 Commitment |
| `04_<topic>_checkpoint.md` | Current checkpoint | The unresolved tension and next-action decision point | 1 Outcome, 1 Constraint, 1 Commitment |

Optional packet: **1 restricted Markdown artifact** if we want to demonstrate permission-limited evidence behavior in the live UI.

| File | Artifact role | What it must prove | Required memory objects |
| --- | --- | --- | --- |
| `05_<topic>_restricted_note.md` | Restricted trust evidence | Member users cannot see restricted evidence, traces, or derived outputs | 1 Decision or Assumption with clearly identifiable restricted marker text |

## The one scenario thread

Pick exactly one scenario. Good demo scenarios have a clear before/after conflict.

Examples:
- self-serve onboarding launch moved from Q3 to late Q2,
- enterprise analytics rollout delayed then reintroduced,
- mobile beta release expanded despite reliability constraints,
- pricing packaging launch reversed after sales pressure,
- migration deadline pulled forward despite security review gaps.

Use one repeated **topic phrase** across every artifact. This phrase is what current graph-linking and contradiction/drift ranking use to connect the history.

Good topic phrases:
- `self-serve onboarding launch`
- `enterprise analytics rollout`
- `mobile beta release`
- `pricing packaging launch`

Bad topic phrases:
- `launch` only — too generic,
- `project` only — too generic,
- changing names across files — weak graph links.

## Exact compatibility requirements

These requirements match the current implementation in `backend/app/services/ingestion.py` and `backend/manual_eval/run_seed_eval.py`.

1. **Use Markdown files (`.md`) for the demo packet.**
   - The app supports Markdown, plain text, PDF, and pasted text, but Markdown is the most deterministic demo format.
   - PDFs must be text-extractable and are not recommended for the core demo.

2. **Put a concrete date in the first 12 lines.**
   - Exact format: `Date: YYYY-MM-DD`
   - Example: `Date: 2026-03-18`
   - This becomes the fallback event timestamp for memory objects.

3. **Use these exact section headings.**
   - `## Decision` or `## Decisions`
   - `## Assumptions`
   - `## Constraints`
   - `## Outcomes`
   - `## Commitments`

4. **Write one memory-worthy claim per sentence or line.**
   - Keep claims short and explicit.
   - Avoid tables for the demo packet.
   - Avoid burying multiple decisions in one paragraph.

5. **Use parser-friendly wording.**

| Memory type | Best wording | Example |
| --- | --- | --- |
| Decision | `We decided to ...` | `We decided to move the self-serve onboarding launch target to Q3 2026 and prioritize foundation work first.` |
| Assumption | `We assumed ...` / `The team believed ...` | `We assumed manual onboarding could absorb demand through Q2 if monthly volume stayed under 40 accounts.` |
| Constraint | `must`, `cannot`, `limited`, `requires`, `capacity` | `The team was limited to five engineers and one designer through Q2.` |
| Outcome | `reached`, `increased`, `slipped`, `missed`, `lacks`, `blocked`, `delayed` | `Manual onboarding volume reached 68 accounts per month and response times slipped to nine days.` |
| Commitment | `<Owner> will <action> by YYYY-MM-DD.` | `Ravi will publish a revised onboarding roadmap by 2026-01-14.` |

6. **Repeat the same topic phrase in related claims.**
   - The graph linker needs overlapping topic terms.
   - Use at least two repeated non-generic words in every key claim.
   - Example repeated phrase: `self-serve onboarding launch`.

7. **For contradiction demo reliability, include a Q2/Q3 or equivalent timing conflict.**
   - Current contradiction heuristics are strongest when the earlier and later decisions share the same topic and include conflicting timing such as `Q2` and `Q3`.
   - Baseline example: `move ... to Q3 2026`.
   - Later conflict example: `reintroduce ... for late Q2 2026`.

8. **For assumption-drift demo reliability, include a measurable assumption and later negative outcome.**
   - Assumption example: `under 40 accounts`.
   - Later outcome example: `reached 68 accounts` and `slipped to nine days`.

9. **For next-action demo reliability, include at least one open commitment with owner and due date.**
   - Exact date format in commitments: `by YYYY-MM-DD`.
   - Example: `Product and engineering leads will decide by 2026-04-12 whether to keep the late-Q2 launch or revert to Q3.`

10. **Keep each artifact compact.**
    - Target: 250-900 words per file.
    - For the most deterministic demo, keep each file under roughly 1,000 characters when possible, because the current chunk size is 1,200 characters.

## Data quality checklist

Before handing the packet back, confirm:

- [ ] All files are Markdown (`.md`).
- [ ] All files start with `# Title` and `Date: YYYY-MM-DD` in the first 12 lines.
- [ ] The same topic phrase appears in all four required artifacts.
- [ ] There is one earlier decision and one later conflicting/revised decision.
- [ ] The conflict is visible in plain language, preferably Q2 vs Q3 or delayed vs reintroduced.
- [ ] There is one measurable assumption.
- [ ] There is one later outcome that weakens or reverses that assumption.
- [ ] There is one unresolved current checkpoint.
- [ ] There are at least two commitments with `will` and `by YYYY-MM-DD`.
- [ ] No sensitive customer names, employee private data, secrets, unreleased financials, or credentials are included.
- [ ] If real names are sensitive, replace them with role names like `Product lead`, `Engineering lead`, `Support lead`.

## What I will wire this data into

Once you provide the filled files, I will wire them into the demo in two places:

1. **Live UI demo path**
   - Upload each `.md` file in order through the Artifacts screen.
   - Run ingestion for each artifact.
   - Use the four demo questions in `docs/demo/SCENARIO_WIRING.md`.

2. **Repeatable isolated eval path**
   - Copy final sanitized files into `backend/manual_eval/product_roadmap_seed/` using filenames `01_*.md` through `04_*.md`.
   - Update `backend/manual_eval/product_roadmap_seed/MANIFEST.md` with upload order and questions.
   - Update `backend/manual_eval/product_roadmap_seed/expected_signals.json` with expected answer fragments.
   - Run: `cd backend && .venv/bin/python -m manual_eval.run_isolated_seed_eval`.

See `docs/demo/SCENARIO_WIRING.md` for the exact wiring steps and `docs/demo/templates/` for copyable artifact templates.
