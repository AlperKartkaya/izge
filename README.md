<p align="center">
  <img src="frontend/public/icon.png" alt="İzge mark" width="96">
</p>
<h1 align="center">İzge</h1>
<p align="center"><b>A local-first institutional memory and decision intelligence system.</b></p>
<p align="center">
  <a href="https://izge.dev"><img alt="Website" src="https://img.shields.io/badge/website-izge.dev-111827?logo=googlechrome&logoColor=white"></a>
  <a href="https://app.izge.dev"><img alt="Live Demo" src="https://img.shields.io/badge/demo-app.izge.dev-4f46e5?logo=googlechrome&logoColor=white"></a>
  <img alt="System" src="https://img.shields.io/badge/system-Decision_Intelligence-059669">
  <img alt="Storage" src="https://img.shields.io/badge/memory-Local--first-0284c7">
  <img alt="FastAPI" src="https://img.shields.io/badge/backend-FastAPI-009688?logo=fastapi&logoColor=white">
  <img alt="React 19" src="https://img.shields.io/badge/frontend-React_19-61DAFB?logo=react&logoColor=black">
  <img alt="TypeScript" src="https://img.shields.io/badge/UI-TypeScript-3178C6?logo=typescript&logoColor=white">
  <img alt="Database" src="https://img.shields.io/badge/storage-SQLite-003B57?logo=sqlite&logoColor=white">
</p>

---

## Ask İzge: Grounded Reasoning & Transparent Thinking

Ask why a decision was made, what contradicts it, or what changed across organizational history.

<p align="center">
  <img src="docs/assets/ask-izge.gif" alt="Ask İzge: Transparent multi-step thinking and cited decision reasoning" width="960">
</p>

- **Transparent Thinking Phases:** Displays explicit execution stages—planning, artifact retrieval, cross-signal verification, and source checking—before presenting the conclusion.
- **Strict Evidence Grounding:** Every claim links directly to primary sources (invoices, service agreements, delivery logs) via clickable citation chips.
- **Contradiction Detection:** Surfaces conflicts between delivered work and commercial contracts in real time.

---

## Team Chat: The Colleague in Daily Work

Mention `@izge` directly inside team discussions to resolve conflicting assumptions and pull verified records into the conversation.

<p align="center">
  <img src="docs/assets/team-chat.png" alt="İzge in Team Chat: Uncovering unbilled delivery and citing evidence in team conversation" width="960">
</p>

- **Consequential Discovery:** Cross-references delivery logs (18 hours) with service contracts (₺2,000/hr) and monthly invoices (maintenance only) to catch **₺36,000 + VAT** in unbilled work.
- **In-Stream Sources:** Expandable source excerpts embedded directly within the chat stream for instant team verification.
- **Human Decision Loop:** Leaves financial and commercial decisions with accountable team leads, providing the evidence needed to act.

---

## Daily Review: Proactive Intelligence & Continuity

A morning command center for team leads and employees, surfacing drift and commitments before meetings start.

<p align="center">
  <img src="docs/assets/daily-review.png" alt="İzge Daily Review: Proactive signals, open commitments, and continuity tracking" width="960">
</p>

- **Proactive Signals:** Automatically detects continuity overlap with past postmortems, decaying assumptions, and open commitments.
- **Work Tracking:** Distinguishes completed work from active deliverables without requiring repetitive status meetings.
- **Repeated-Work Avoidance:** Alerts employees when newly submitted proposals duplicate historical efforts.

---

## Core Stance

- **Memory before magic** — Structured institutional history outranks generative speculation.
- **Evidence before confidence** — Never trust an assertion without a clickable primary record.
- **Local-first sovereignty** — Customer-controlled database and private inference. Sensitive corporate memory never leaves your boundary.

---

## Quickstart

### Prerequisites
- Python 3.11+
- Node.js 20+

```bash
# 1. Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -e .
python -m app.migration_tools upgrade
uvicorn app.main:app --reload --port 8000

# 2. Frontend (in another terminal)
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` to explore the workspace.

For containerized deployment, comprehensive operations, backup routines, and evaluation suites, see [`docs/OPERATIONS.md`](docs/OPERATIONS.md) and [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

---

## Built with

Built with [FastAPI](https://fastapi.tiangolo.com/), [SQLAlchemy](https://www.sqlalchemy.org/), [SQLite](https://www.sqlite.org/), [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Vite](https://vite.dev/), and deep care for organizational truth.
