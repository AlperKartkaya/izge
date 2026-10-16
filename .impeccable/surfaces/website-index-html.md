---
version: 2
slug: "website-index-html"
primary_target: "website/index.html"
related_targets: ["website/styles.css","website/hero-motion.css","website/story.js","website/story-data.js","website/i18n.js","website/journey-motion.js","website/scroll-motion.js","website/finale-motion.js","website/hero-motion.js","website/source-markdown.js"]
---

# Website

Mode: Persuade through a product story. Audience: company decision-makers, shown through an employee workflow. Primary action: open the existing Izge demo. Proof: a local, deterministic Atlas review grounded in bundled contract, delivery, and invoice records. The page does not claim a live model run, recovered revenue, or an executed external action.

The current requested direction is implemented as a code-led motion experience. The earlier discovery composition at `.impeccable/mocks/decision/discovery.png` is historical context, not current layout approval. No replacement raster comp was generated for this motion extension.

## Direction contract

THESIS: Show company memory becoming a useful teammate: records connect, a gap becomes visible, a sourced response is prepared, and repeatable review brings the work back to the team.

OWN-WORLD: Preserve the established near-black teal canvas, pearl text, pale-blue actions and evidence states, restrained warm review emphasis, real Izge mark, Cambay display type, Inter interface type, source disclosure, and message anatomy.

STORY: Begin nearly blank, then assemble the mark, documents, unlabeled relationship graph, marked `@izge` conversation, and qualified finding in a finite 12-second opening. The welcome text fades over 200ms while header and hero copy appear; then the logo fades out in place over 200ms. It fades back in at the graph center at 1.4 seconds without sliding, and sources/graph construction start immediately. The graph-to-conversation interval is 1.25 seconds; Ece enters before Izge. A text-only shimmer indicates thinking. Izge thinks from 3.45–5.45 seconds and streams the opening reply from 5.45–7.45 seconds; no opening controls compete with the scene. Continue through four scroll chapters, with the daily-review rows entering sequentially and reversing with scroll. Pin an initially empty team workspace while continued native scrolling carries the full composer upward into a right-aligned `You` / `Siz` message, reveals thinking, accelerates the fixture stream with scroll velocity, and then admits colleague replies. Reverse scroll removes later messages and rewinds the stream until forward progress resumes. The final scroll range raises and enlarges the Izge closing, demo action, and contact action until they own the viewport.

FIRST VIEWPORT: The welcome text is centered beneath the opening logo. A one-line Turkish / two-line English colleague proposition sits above a graph-and-conversation scene. The opening assembles without scroll hijacking or playback controls and settles into complete readable content. Scrolling away completes rather than strands the sequence. Reload clears scroll and hash to restart the story; ordinary deep links still keep their destination.

FORM: Standalone semantic HTML, CSS, and JavaScript with no new runtime dependency, backend request, or raster composition. Native scroll drives four reversible chapter states and the pinned finale without cancelling wheel or touch input. `prefers-reduced-motion` and viewports no taller than 500px use fully readable static forms. Functional type never drops below 11px.

FINISH: EN/TR share the same hierarchy and behavior. Source controls open the native fixture-backed dialog, render bundled Markdown as semantic headings, lists, emphasis, and tables, and restore focus. The final team scene remains deterministic, removes a redundant secondary heading, and keeps pause/replay in the team controls. Tests target the current DOM, opening timing and reload behavior, four chapters, sequential review rows, rendered source behavior, responsive states, and forward/reverse finale progression.

## Implementation boundary

`website/index.html` loads `styles.css`, `hero-motion.css`, and `story.js`. `story.js` coordinates `story-data.js`, `i18n.js`, `journey-motion.js`, `scroll-motion.js`, `finale-motion.js`, `hero-motion.js`, and `source-markdown.js`. `scroll-motion.css` is retained historical work and is not active. The memory-weave scripts, rasters, and specifications are also historical references.

The closing provides the existing demo destination and a `mailto:alperkartkaya@gmail.com` contact link. Within the walkthrough, the animated composer does not send a message, contact a customer, call a model, create an invoice, or change external state. Potential ₺36,000 + VAT remains subject to customer confirmation and commercial approval; a person owns the decision.

Verification: run the Node tests for content, fixture arithmetic, Markdown rendering, opening timing, chapter/review state, and forward/reverse conversation state; run `browser-smoke.mjs` and `motion-browser.mjs` against a local server for the current DOM, focus/Escape, EN/TR, responsive overflow, control-free finite intro, reload/deep-link behavior, four chapter states, upward self-send, reversible conversation, team pause/replay, closing transition, and short-landscape and reduced-motion fallbacks. These checks do not establish production availability or provider end-to-end behavior.
