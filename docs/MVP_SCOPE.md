# MVP_SCOPE.md
## Strict V1 Scope for Izge

## V1 purpose
The system reconstructs decision history from internal artifacts and produces useful present-day decision guidance.

## What V1 must do
- accept uploaded internal documents and pasted text,
- allow members to contribute logs, reports, presentations, notes, and updates,
- store and process artifacts locally within company-controlled infrastructure,
- parse and chunk supported artifacts,
- extract structured memory objects,
- build an explicit institutional-memory graph,
- answer decision-lineage, contradiction, assumption-drift, and next-action questions,
- detect contradiction / drift / supersession when a newly submitted artifact conflicts with existing memory,
- present evidence-backed next-action guidance,
- display traceability for why an answer or signal was produced,
- surface active contradictions, assumption drift, and next actions in overview pages.

## What V1 must not do
- depend primarily on external hosted AI services,
- integrate every enterprise tool,
- support OCR, audio, or video ingestion,
- become a general-purpose chatbot,
- become generic enterprise search,
- become a broad no-code orchestration platform,
- implement full scenario simulation,
- require fully distributed edge inference across all employee devices.

## Supported inputs
- Markdown files
- plain text files
- PDF files (text-extractable only)
- pasted text
- member-submitted logs, reports, notes, and presentation summaries in the supported formats above

## Supported outputs
- structured memory objects
- relationship graph / graph summaries
- query results for the four core reasoning modes
- proactive contradiction / assumption-drift / next-action signals
- evidence-backed detail views

## Wedge domain
The MVP wedge is **product and roadmap history**, while remaining structurally capable of supporting recurring continuity use cases such as intern report handoff and task anti-duplication.

## Anti-goals
- do not drift into chat-over-files
- do not frame the product as internal search
- do not become an admin-heavy platform before the core workflow is excellent
- do not overbuild distributed model-routing before the central local-first workflow is strong
- do not let decorative UI overpower reasoning clarity

## Success statement
V1 is successful when an admin can prepare a real workspace, a member can ask a real product-history question or submit a conflicting new artifact, and Izge can return an evidence-backed contradiction / drift / guidance outcome that feels materially different from search or chat.
