# MVP_SCOPE.md
## Strict V1 Scope for Institution Memory Engine

## V1 purpose
The system can reconstruct decision history from internal artifacts and produce useful present-day decision guidance.

## What V1 must do
- accept uploaded internal documents and notes,
- parse and index them locally,
- extract structured decision-memory objects,
- build a decision-memory graph,
- answer queries about past decisions,
- identify contradictions and stale assumptions,
- generate evidence-backed next-step recommendations,
- display a trace of how the answer was formed.

## What V1 should not do
- integrate every enterprise tool,
- support real-time Slack ingestion by default,
- be a general-purpose chatbot,
- do arbitrary workflow automation,
- become a full simulation engine,
- send external messages or take sensitive actions,
- build an enormous analytics dashboard,
- support too many personas.

## Recommended V1 focus domain
Choose one of:
- product and roadmap history,
- operations incident and postmortem history,
- strategy and policy documents.
