# Izge Design Contract

## Purpose

Izge has two intentionally different product experiences:

1. **Admin operations** — the buyer-side operator who prepares, governs, observes, and improves the company memory system.
2. **Employee workspace** — the customer-company worker who needs to finish real work using the memory, evidence, assistant, graph, and team chat they are allowed to access.

This file is the repo-local source of truth for UI/UX choices. Frontend changes should preserve this split unless a product decision explicitly changes the roles.

## Evidence reviewed

- `docs/UI_UX_SPEC.md`: admins prepare/govern memory; members contribute to and reason over it; the UI must not collapse into generic dashboard sludge.
- `docs/PRD.md`, `docs/REQUIREMENTS.md`, `docs/DOMAIN_MODEL.md`: Izge is evidence-first company memory, not a marketing site.
- `docs/OPERATIONS.md`: operational observability belongs to admins/operators.
- `frontend/src/layout/AppShell.tsx`: current global navigation controls role-visible surfaces.
- `frontend/src/pages/DashboardPage.tsx`: current home page mixed employee work with operational readiness/admin concepts.
- `frontend/src/pages/QueryPage.tsx`: full-page employee assistant with session persistence and permission-limited retrieval.
- `frontend/src/pages/TeamChatPage.tsx`: team chat already models workplace conversations.
- `frontend/src/pages/ArtifactsPage.tsx`: evidence browsing/intake is a shared employee/admin surface, while review governance is admin-specific.
- `frontend/src/pages/GraphPage.tsx`: interactive memory graph is useful for both employees and admins when framed as evidence exploration.

## Role definitions

### Employee

An employee is a worker at the company using Izge. They are not here to learn the product architecture or operate infrastructure. They need a task-finisher experience:

- ask a grounded company-memory question,
- continue a team conversation,
- open accessible evidence,
- inspect a signal or graph item when work needs a decision,
- contribute source material when they have company evidence to add.

Employees should not be pushed through orchestration, ingestion jobs, readiness diagnostics, database/audit tooling, or internal implementation language.

### Admin

An admin is responsible for the deployed workspace. They need operational controls:

- source intake and ingestion oversight,
- evidence review/governance,
- database/admin views,
- audit logs,
- job/readiness visibility,
- user management.

## Employee information architecture

Employee top navigation should stay short and task-first:

1. **Home** — a cockpit for finishing work today.
2. **Assistant** — ask Izge using only accessible artifacts and memory records.
3. **Team chat** — coordinate with coworkers inside the company workspace.
4. **Evidence** — open, preview, download, or contribute source material they can access.
5. **Graph** — explore the memory graph and act on signals.

Admin-only/operations-first destinations should not appear in the employee nav: Ingestion, Memory FS, Jobs, Readiness, Data, Audit, Users, and Docs.

## Employee home design

The employee home must answer: **“What can I finish right now?”** It should not look like an admin dashboard.

Required structure:

- A calm hero with the user name and workspace readiness in plain language.
- Primary actions for the next tasks: ask assistant, team chat, evidence, active signal/graph.
- A work queue built from persisted signals, contradictions, drift, and next actions.
- Recent accessible evidence with direct action links.
- Minimal metrics, only where they help the employee choose a next action.

Avoid:

- marketing slogans,
- repeated same-looking card grids,
- infrastructure labels as primary copy,
- dense operational metrics,
- admin-only routes in employee calls to action.

## Admin home design

The admin dashboard can remain operational. It should make source, memory, signal, review, readiness, and governance state visible. Admin copy may use operational terms because the admin is responsible for the deployment.

## Visual principles

- Dark mode is the default product feel; light mode remains optional through the theme toggle.
- Employee surfaces should be modern, quiet, and minimal: fewer cards, clearer rows, stronger hierarchy.
- Use tables/lists when the content is scannable work, not generic rectangular cards.
- Every employee action should lead to a real destination where work can continue.
- Statuses should be readable as human work state, not just system state.

## Access and permission UX

Employee UI must reinforce that answers and evidence are scoped to what the signed-in employee can access. It should say this plainly when relevant, but not over-explain the internals.

Recommended employee copy:

> “Answers use only the company memory and artifacts you can access.”

## Current implementation commitments

- Employee and admin navigation are role-specific in `AppShell`.
- Employee `/` renders a task-first home inside `DashboardPage`.
- Admin `/` keeps the operations dashboard inside `DashboardPage`.
- Admin-only operational routes are guarded in `App.tsx` so employees who manually enter those URLs return to the employee home.

## Employee chat and source previews (2026-10-09)

- `/query` and `/team-chat` fill the viewport below the shared navigation. The document never scrolls; message history and the conversation directory scroll independently. Polling must not move a reader away from older messages; new replies follow only while already near the bottom, after sending, or on thread selection.
- Adapt beautiful-ui 07 Chat (message hierarchy), 08 Prompt Bar (two-row composer, source chip and send control), and 10 Context Cards (daily review with evidence cards) to existing CSS tokens and real API state. No scripted replies, fake tools, model picker or new dependencies.
- Enter sends, Shift+Enter adds a line; IME composition is not submitted. The composer remains visible and keyboard accessible.
- Evidence opens in a centered native modal, not a new tab: roughly 620×440px maximum, responsive on small screens, scrollable content, top-right close button, Escape and focus return. Render text safely and PDFs as authenticated blob previews; permission errors remain visible and unsupported binary is never rendered as text. Browsers without a native PDF viewer show a clearly labeled 500-character extracted-text preview and a download link rather than a blank frame.
- The memory source directory has a bounded scroll region. Daily evaluation keeps its complete answer and source quotes available without expanding an unbounded card stack.
- Website content, backend behavior and administration features remain outside this UI change. Existing admin source-preview links also reuse the same modal; downloads remain unchanged.

## Demo communication and proactive work (2026-10-09)

- Team Chat lists conversations that contain messages plus explicit Şirket geneli/İzge threads; the colleague directory appears only while starting a new direct or group conversation.
- `@izge` is visually distinct in the composer and sent messages. Selecting its accessible autocomplete inserts text but does not send. A message containing the mention invokes İzge in the same thread.
- Agent answers render only safe text structure (paragraphs, lists and bold), turn validated numeric citations into source-title preview chips, show compact evidence context cards, and offer follow-up choices that fill/focus the composer with `@izge` for editing.
- Notifications combine unread team messages and proactive İzge findings. Opening one marks it read and routes to its exact Team Chat or İzge thread; the navigation badge polls the persisted unread count.
- Artifact-review findings open as İzge-started conversations: the internal review prompt is not presented as a user message. Query history is thread-scoped instead of mixing independent conversations.
- Automations expose real persisted daily İzge jobs with a minimal create/pause/run flow. Scenario templates only prefill the form. Mailbox control is visibly disabled until a connector exists; the UI never simulates external mailbox access.

## Product-wide refinement (2026-10-11)

This is an **Operate** refinement, not a new visual identity. Keep the current logo,
Inter/system sans stack, default dark theme, optional light theme, routes, access
checks and source provenance. No dependencies or backend/API changes.

- Palette: existing dark canvas `#05070d`, surface `#0c131d`, secondary surface
  `#121d2b`, text `#f8fafc`, muted text `#a7b3c5`, accent `#9cb5ff`.
  Use semantic tokens, including a dark foreground on the pale dark-theme CTA.
- Type: page titles 24–32px; section titles 18–20px; body 14–16px; secondary
  labels 12–14px. Sentence case, tabular numbers, readable prose measure.
- Layout: left-aligned title + action, then the working list; contextual details
  follow selection. Rows and whitespace replace nested cards. One surface boundary
  for an editor/table/chat region, not one per item.
- Flow: `[title + action] / [filter + working list] / [selected detail]`.
  Source/task intake and diagnostic metadata are progressive disclosures.
  Error, permission, evidence and cloud data-boundary messages stay available.
- Employee home prioritizes work and changes; admin pages prioritize problems and
  the next action. Completed tasks are not part of the open-task queue.
- Chat keeps message scroll/composer behavior, sources and complete answer access;
  compact citations and expandable reports reduce reading interruptions.

The skill-generated hero/features template and replacement palette were rejected:
this is an existing evidence-first workspace, not a conversion landing page.
UI UX dataset searches did not yield a relevant disclosure match; the supplied
web accessibility/disclosure guidance and existing native controls guide that work.

### Change and verification plan

1. Establish current node-test baseline; add regression coverage before behavioral edits.
2. Refine shared headings, metrics, navigation, focus, tables and form surfaces.
3. Independently refine admin operations, employee content and sources/tasks/graph.
4. Review changed source against Web Interface Guidelines, integrate fixes, then
   run node tests, lint, TypeScript and production build.

Browser use, browser tests, screenshots and visual verification are explicitly
excluded. Code checks do not establish rendered visual quality or runtime usability.

### Code-only verification (2026-10-12)

- `npm test --prefix frontend`: 63 passed, 0 failed. Includes task completion,
  navigation matching, source filtering/sorting, markdown previews, graph spacing,
  paging/routing bounds, and structural accessibility regressions.
- `npm run lint --prefix frontend`: passed.
- `npm run build --prefix frontend`: TypeScript (`tsc -b`) and Vite passed.
- `git diff --check`: passed.
- Web Interface Guidelines source review led to fixes for keyboard-operable graph
  edges, theme-aware graph labels, semantic disclosures, localized status tones,
  stage outcome text alternatives and selected-job source provenance.
- Vite still warns about the ~565 kB minified JavaScript bundle; code splitting
  was not added as part of this refinement. No browser/runtime/visual validation
  was performed. Structural tests and selected contrast pairs are not a full
  accessibility conformance audit.

## Screenshot follow-up (2026-10-12)

The supplied screenshots show old source-card controls and headings absent from the
current source. Do not assume the deployed build matches the checkout. This pass
fixes source-level defects regardless; it does not deploy or validate a browser.

- Move the supplied SVG/PNG into frontend brand assets and use them in product chrome.
- Constrain chat flex children and long prose/tables at the message boundary; show
  evidence as compact expandable rows, never a second dashboard inside a message.
- Notifications are readable items, not whole-row navigation: separate expand,
  read/unread, delete and conversation actions, backed by user-scoped persistence.
- Replace custom graph interactions with a mature React library; keep relationships
  evidence-backed and expose connected sources and records, not decorative nodes.
- Put actual runs and scenario actions before developer diagnostics. Preserve raw
  runtime evidence only in explicitly named technical disclosures.
- Keep identical shell padding/scrollbar allocation between chat and ordinary pages.
- Add targeted regressions before each behavior change, then run code-only checks.

### Follow-up implementation and evidence

- The supplied `icon.svg` is the shared product mark in
  `frontend/src/assets/branding/`; `frontend/public/icon.svg` and `icon.png`
  provide browser/touch icons. The SVG inherits the current interface color.
- React Flow (`@xyflow/react` 12.12.0, MIT) replaces the custom SVG interaction
  engine. Its [official accessibility guidance](https://reactflow.dev/learn/advanced-use/accessibility)
  informed keyboard selection and localized ARIA instructions. Source scoping
  includes recorded cross-source neighbors; no relationships are invented.
- New notification detail/unread/delete API operations preserve recipient and
  workspace checks. Polling returns bounded summaries; full evidence is fetched
  only on disclosure open and permission-checked again. Legacy truncated bodies
  are recovered from their linked run/message when available.
- Creating a conversation reuses an existing empty active draft, serialized per
  user in the database. Attached drafts are not discarded. The frontend merges
  reused IDs rather than adding duplicate history entries.
- Latest complete checks: 70 frontend tests and 127 backend tests passed;
  frontend ESLint, TypeScript + Vite build, and whitespace checks passed.
- The graph is lazy-loaded (~213 kB minified); main JavaScript remains ~535 kB,
  so Vite's 500 kB warning remains. Production `npm audit` reports two high-level
  entries in the existing React Router dependency chain; no dependency upgrade
  outside the graph integration was performed.
- No browser automation, screenshots, live rendering verification, deployment,
  running-service restart, commit or push was performed in this follow-up.

The final source review has no outstanding high/medium findings in the changed
flows. A regression covers legacy trailing unpaired bold markers without changing
stored text, valid bold, inline code, or literal exponent notation. This source
review does not supersede the dependency audit or the no-browser evidence limit.
