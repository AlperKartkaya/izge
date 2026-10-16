# Izge public website

Standalone HTML/CSS/JavaScript product story for the Izge public website. It uses bundled Atlas demo records and deterministic local interactions. The walkthrough makes no product API, model, messaging, invoice, or customer-contact request.

## Run locally

From the repository root:

```sh
python3 -m http.server 5179 --directory website
```

Open `http://127.0.0.1:5179`.

## Test

Run the dependency-free content, fixture, timeline, and controller checks:

```sh
node --test website/tests/*.test.mjs
```

The optional browser tests require an existing Playwright installation and a local server. No Playwright package is added to this repository.

```sh
WEBSITE_URL=http://127.0.0.1:5179 \
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
node website/tests/browser-smoke.mjs

WEBSITE_URL=http://127.0.0.1:5179 \
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
node website/tests/motion-browser.mjs
```

Both browser scripts accept only `127.0.0.1` or `localhost`. They cover the current DOM, rendered source Markdown, source-dialog focus and Escape behavior, EN/TR persistence, responsive overflow, the control-free 12-second opening, welcome fade, stationary logo fade-out/fade-in without travel, early header/copy reveal, immediate graph-on-arrival construction, staggered messages, slow-module/fail-open guards, and two-second thinking/two-second stream, reload reset and ordinary deep links, four chapter states, reversible sequential daily-review rows, the empty initial finale, upward full-size composer send, right-aligned `You` / `Siz` self-message, reversible conversation, team pause/replay controls, velocity-assisted fixture stream, scroll-gated colleague replies, growing closing scene, reduced motion, short-landscape fallback, and browser errors. Screenshots are written to `.impeccable/review/`.

## Current modules

- `index.html` contains the bilingual semantic structure and reload-only scroll/hash reset: the opening memory scene, four chapters, team/private discussion, closing actions, and native source dialog. Ordinary hash navigation remains intact. The tab title stays “İzge - Ekip arkadaşınız” in both languages; a cache-busted current-logo SVG favicon has a 32px PNG fallback.
- `styles.css` owns the active visual system, opening assembly, chapter layouts, responsive rules, and the readable stacked fallback used by reduced motion and viewports no taller than 500px.
- `journey-motion.js` runs the control-free 12-second opening sequence, including a 200ms welcome fade with early header/copy reveal, then a stationary logo fade-out and reveal at the graph center with immediate graph construction, Ece before Izge, a text-only thinking shimmer from 3.45–5.45 seconds, and the reply stream from 5.45–7.45 seconds. Late boot cannot replay a page already revealed by the bounded fallback.
- `scroll-motion.js` maps native scroll progress and chapter links to the four chapter states, including sequential and reversible daily-review rows. Its active presentation rules live in `styles.css`.
- `finale-motion.js` pins the final scene to native scroll progress, starts with an empty transcript, moves the full composer upward into a right-aligned self-message, gates colleague replies, and raises and enlarges the closing statement without intercepting wheel or touch input.
- `hero-motion.js` and `hero-motion.css` run the deterministic team scene without a redundant secondary heading: thinking phases, a 50%-faster baseline stream that accelerates with scroll velocity, citations, employee reactions, pause, replay, reduced-motion completion, and reverse-scroll removal/unstreaming that holds until forward progress resumes.
- `source-markdown.js` safely renders the bundled fixture subset—headings, paragraphs, emphasis, lists, and tables—without interpreting raw HTML.
- `story-data.js` holds the EN/TR fixture-backed sources and deterministic team/private messages. `story.js` coordinates language, rendered source disclosure, conversation selection, and the motion modules. `i18n.js` applies and persists EN/TR copy.
- `tests/browser-smoke.mjs` and `tests/motion-browser.mjs` target the current DOM and motion behavior. The `*.test.mjs` files cover data, language, and pure timing/state functions.

`scroll-motion.css` is an inactive historical stylesheet and is not loaded by `index.html`. `memory-field.js`, the memory-weave raster studies, and `docs/MEMORY_WEAVE_*.md` are also retained as historical references, not current implementation or approval.

## Design documentation

- `website/DESIGN.md` records the website-only system implemented by the current files.
- `.impeccable/design.json` is its machine-readable sidecar.
- `.impeccable/surfaces/website-index-html.md` records the current surface direction. Earlier discovery compositions are historical context, not the approved layout.

## Railway deployment

The production target is the `izge-website` Railway service at `izge.dev`. Its service build must use the repository root and `deploy/website.Dockerfile`; the application services are separate and must not be selected.

From the linked repository root:

```sh
railway up . --service izge-website --environment production --detach
```

This command is the deployment reference only; this document does not claim a deployment completed successfully.
