---
name: Izge Website
description: A quiet product story where company memory becomes useful inside the team's work.
colors:
  canvas: "#101619"
  surface: "#121a20"
  raised: "#18222d"
  ink: "#e8edf4"
  muted: "#adb9c9"
  accent: "#9cb5ff"
  action: "#8dbdf3"
  action-ink: "#0b1828"
  warm-finding: "#f2c79f"
  line: "#303c49"
typography:
  hero-display:
    fontFamily: "Cambay, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(44px, 4.9vw, 76px)"
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: "-0.03em"
  section-display:
    fontFamily: "Cambay, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(36px, 4.2vw, 62px)"
    fontWeight: 700
    lineHeight: 1.06
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  compact-body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  caption:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  micro-label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  inline: "3px"
  compact: "6px"
  control: "8px"
  source: "10px"
  surface: "12px"
  round: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
  3xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.action-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "12px 22px"
    height: "46px"
  source-control:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.source}"
    padding: "14px 16px"
    height: "66px"
  conversation-control:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.compact}"
    padding: "9px 14px"
    height: "44px"
  source-dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.surface}"
    padding: "0"
    width: "min(680px, calc(100% - 32px))"
---

# Design System: Izge Website

## Overview

**Creative North Star: "Memory Joins the Team"**

The website is a quiet, dark product stage that begins almost empty and assembles Izge's role in front of the visitor: mark, documents, relationships, conversation, and a qualified finding. It then moves through four product chapters—company memory, finding, customer-response draft, and scheduled review—before native scroll carries a complete team exchange into a closing invitation.

This is a standalone HTML/CSS/JavaScript expression of the Izge identity. It preserves the real mark, bundled Cambay and Inter type, grounded fixture data, rendered source disclosure, and message anatomy. Every apparent AI or operational state uses deterministic local fixtures; the walkthrough does not send a message, contact a customer, create an invoice, or call a model.

The earlier finding-first discovery composition remains a historical exploration, not the current implemented layout. The current code-led motion experience is the source of truth; no raster composition defines its structure.

**Key Characteristics:**

- Near-black teal canvas with restrained blue and warm review accents.
- Cambay statements paired with practical Inter interface text and the Izge mark.
- A finite 12-second blank-to-built opening whose reply thinks for two seconds and streams for two, with no opening playback controls.
- Four reversible native-scroll chapters with readable stacked fallbacks.
- A scroll-pinned `@izge` team playback with an animated send, thinking, velocity-assisted fixture stream, citations, and scroll-gated employee reactions.
- EN/TR parity, native source disclosure, and explicit human authority boundaries.

## Colors

The palette stays cool and low-chroma so actions, evidence links, and the warm pending-review finding retain meaning.

### Primary

- **Decision Blue:** The action token fills primary demo links and meaningful calls to action; its dark companion keeps those controls readable.
- **Evidence Blue:** The accent token marks focus, active navigation, source links, graph nodes, citations, and selected details.

### Secondary

- **Review Warmth:** The warm-finding token identifies a consequential candidate that still requires confirmation and commercial approval. It is not a success color.

### Neutral

- **Night Canvas:** The canvas token owns the page background and the darkest embedded controls.
- **Evidence Surface:** The surface token contains documents, drafts, discussion, and the native source dialog.
- **Raised Context:** The raised token identifies mentions, selected controls, hover states, and local emphasis.
- **Pearl Ink:** The ink token carries primary reading content.
- **Quiet Metadata:** The muted token carries supporting copy, disclosures, filenames, and status text without dropping below the functional type floor.
- **Structural Line:** The line token separates regions, records, and controls instead of creating stacks of shadows.

**The Warmth Requires Review Rule.** Warm text means “look closer and decide,” never “revenue recovered” or “work completed.”

## Typography

**Display Font:** Cambay (with Inter and system sans fallbacks)  
**Body Font:** Inter (with system sans fallbacks)

**Character:** Cambay gives the opening and chapter statements a compact, distinctive voice. Inter keeps evidence, documents, messages, controls, and qualifications operational and easy to scan.

### Hierarchy

- **Hero Display:** The two-line opening statement only.
- **Section Display:** Chapter, discussion, and closing statements.
- **Body:** The opening proposition, chapter explanation, and source-dialog content.
- **Compact Body:** Discussion messages, customer requests, and draft copy.
- **Label:** Primary actions, names, and compact interface headings.
- **Caption:** Navigation, source controls, citations, playback controls, and metadata.
- **Micro Label:** The implemented floor for short statuses, disclosures, and compact evidence values. Do not use type smaller than this functional 11px floor.

**The Evidence Before Superlatives Rule.** Display copy states what Izge connects or prepares; it does not claim autonomous recovery, certainty, or a completed customer outcome.

## Layout

The page uses a fluid wrapper with 48px desktop gutters and a 1440px cap. The opening places a quiet, unlabeled memory graph and compact conversation side by side, marks the `@izge` mention, then resolves into a complete first scene. The chapter stage uses a copy-and-visual split inside a native 440-viewport-height scroll run; one chapter is active at a time without intercepting the wheel or touch input. The daily-review rows enter one by one and reverse in the same order when the visitor scrolls back.

The four chapters keep one narrative order: connected company memory, an overlooked invoice finding, a sourced customer-response draft, and a repeatable scheduled review. After them, one bounded team workspace exposes team/private selection and the same source dialog used throughout the page. On motion-capable viewports, the workspace remains pinned while scrolling visually sends the prepared `@izge` prompt, advances the reply and colleague responses, then raises and enlarges the closing mark, statement, demo action, and contact action.

At 760px and below, the opening and chapters become single-column and the header removes secondary story links. At short heights, the design tightens the stage without shrinking functional text below 11px. At 500px viewport height or less, chapters switch to the same readable stacked document pattern used by reduced motion; every chapter stays available and interactive.

**The Same Story at Every Size Rule.** Responsive changes may stack, tighten, or unpin the composition, but they preserve all four chapters, source access, team/private views, the complete fixture answer, and human-review qualification.

## Elevation & Depth

The system is flat by default. One-pixel structural borders, tonal changes, overlap, and spacing carry depth. The slightly rotated response draft reads as a prepared artifact; the native dialog alone receives a dark backdrop. Motion may reveal structure, but it does not add decorative glow or floating card stacks.

**The Evidence Stays Grounded Rule.** Resting product and evidence surfaces use borders and tonal layers, not promotional shadows.

## Shapes

Compact controls use gently rounded corners, source documents use a slightly larger rectangle, and major bounded surfaces share a 12px radius. Mentions use a tight inline radius. Avatars, graph nodes, the memory core, and status marks may be circular. Thin rules and underlines communicate structure or selection before extra containers do.

## Components

### Primary Buttons

- **Shape:** Compact rounded rectangle with a 46px minimum height.
- **Color:** Pale decision-blue fill with dark action text.
- **Hover / Focus:** Hover moves to pearl ink; keyboard focus uses the shared blue outline with a visible offset.
- **Use:** Reserve for the real demo destination and the final meaningful call to action.

### Closing Actions

The closing composition rises and grows through the final scroll range. It retains the existing demo destination and adds one secondary contact link to `mailto:alperkartkaya@gmail.com`; the contact link opens the visitor's mail client and does not submit a form.

### Source Controls

- **Style:** Document-shaped controls pair a source label with one grounded value inside a bordered evidence surface.
- **State:** Hover changes the surface tone and border. Focus uses the shared outline.
- **Behavior:** Contract, delivery, invoice, and message citations all open the same native dialog with the matching bundled record rendered as safe semantic Markdown.

### Chapter Navigation

- **Style:** Four text links—Remember, Notice, Prepare, Repeat—sit above the stage.
- **State:** The current chapter uses primary ink and a short evidence-blue underline.
- **Behavior:** Links and native scroll address the same four states. Keyboard activation moves focus to the selected chapter heading.

### Draft Sheet

The customer-response draft is the one intentionally paper-like product artifact. It uses the shared surface and border, a restrained one-degree rotation during the animated state, a pending-review label, a source citation, and the explicit “prepared, not sent” footer.

### Team Workspace

The discussion is one bounded surface, not a dashboard. It enters with an empty transcript. Team/private buttons synchronize `aria-pressed`; native finale scroll moves the full composer upward without shrinking or fading, then replaces it with the same right-aligned `You` / `Siz` self-message. Activating the prompt directly remains a manual playback path. Neither path sends a real message. The complete team transcript includes three thinking phases, a fixture-grounded answer streamed 50% faster than the previous baseline, source citations, and two employee reactions revealed by later scroll progress. Scroll velocity temporarily accelerates the stream further. The transcript has no redundant secondary heading. The private view remains a separate deterministic two-message exchange.

### Authored Motion

The opening runs for 12 seconds and then settles. It exposes no pause, skip, or replay controls. At 0.9 seconds the welcome text fades over 200ms while the header and hero copy begin appearing. After the text is gone at 1.1 seconds, the logo fades out over 200ms without moving. At 1.4 seconds it reappears with a 200ms fade at the graph center, without any sliding; sources and graph construction start in that same step. Ece appears at 2.65 seconds and Izge follows at 3.45 seconds. A text-only shimmer marks two seconds of thinking; the reply streams from 5.45 to 7.45 seconds, then stays complete. The graph-to-conversation interval is 1.25 seconds, half the previous 2.5 seconds. Page visibility, focus safety and reduced motion remain supported. A five-second slow-module grace period fails open to readable content; a controller arriving after that never replays the already-revealed page. Scrolling more than 80px completes the opening instead of hiding content above the visitor. A browser reload clears any hash and restarts at the top, while ordinary deep links keep their destination.

The chapter sequence derives state from native scroll progress and reverses when the visitor scrolls back. Reduced motion completes the opening and shows every chapter as a normal stacked document. Short-landscape viewports use the same stacked chapter form. Essential content never depends on animation.

The finale uses native scroll across one pinned stage. It begins with no transcript message. Early progress carries the composer physically upward and resolves it into the right-aligned self-message; middle progress advances thinking and streaming, with active scroll velocity increasing the stream rate; later progress reveals the employee reactions. Reverse scroll removes later replies, rewinds the partial stream, and holds that exact state until forward scrolling resumes. The final range moves the closing composition upward and scales it until it becomes the dominant scene. Team playback controls still provide pause and replay, and playback pauses when hidden, offscreen, manually paused, or when the transcript receives focus. Reduced motion and short viewports render the complete conversation and closing in readable static flow.

### Source Dialog

The native dialog shows the selected source title, filename, and full bundled record. The local renderer supports the bundled records' headings, paragraphs, bold emphasis, unordered lists, and tables through DOM text nodes; it does not interpret raw HTML. Escape, the close control, or a backdrop click closes it; focus returns to the opening control. The footer makes the local-data boundary explicit.

## Do's and Don'ts

### Do:

- **Do** preserve the real Izge mark, the established dark palette, and the Cambay/Inter pairing.
- **Do** keep EN/TR content structurally equivalent and test both languages for overflow.
- **Do** use fixture-grounded documents and keep source access keyboard-operable and focus-restoring.
- **Do** keep deterministic fixture behavior testable and keep customer confirmation, commercial approval, and human review explicit.
- **Do** show the complete final state for reduced motion and the readable stacked chapter fallback at 500px viewport height or less.
- **Do** keep functional text at 11px or larger.

### Don't:

- **Don't** treat an earlier raster or discovery composition as the current layout authority; the implemented HTML, CSS, and JavaScript define this implemented experience.
- **Don't** present thinking or streaming as a live model response.
- **Don't** imply the page sends a message, contacts a customer, creates an invoice, or executes any other external action.
- **Don't** mark the potential amount as recovered revenue, a finalized receivable, or an approved invoice.
- **Don't** let Izge make the commercial decision; a responsible employee reviews and approves the next step.
- **Don't** introduce integration logos, invented metrics, unsupported source formats, decorative glow, or motion without a complete static equivalent.
