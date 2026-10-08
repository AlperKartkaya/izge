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
