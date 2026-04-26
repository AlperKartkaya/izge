# Memory Weave Hero Implementation Spec

Status: approved implementation baseline  
Scope: public landing-page hero  
Implementation status: initial static HTML/CSS/SVG/JS implementation completed in `website/`

## 1. Goal

Create a new landing-page hero centerpiece for Izge based on a **living memory weave**.

The centerpiece should be an interactive explanation of Izge's category:

- decisions connect to assumptions and constraints,
- history can conflict with current direction,
- Izge reveals those tensions from evidence,
- Izge helps teams decide what should happen next.

This should replace or significantly evolve the current hero visual preview while preserving the existing dark, cinematic Izge direction.

## 2. Non-goals

This spec has been approved for the first implementation pass. Future iterations should still not:

- add a generic dashboard mockup,
- add a chat interface,
- add fake analytics numbers,
- use purple AI gradients,
- create decorative Turkish wallpaper,
- introduce product claims beyond the MVP,
- remove the existing scroll-driven scenario section unless explicitly requested.

## 3. Placement

Target surface:

- `website/index.html`
- `website/styles.css`
- `website/memory-field.js`

Placement:

- The Memory Weave belongs in the hero visual area beside/under the opening headline.
- The existing scroll-driven scenario section remains below the anti-category section.
- The weave should serve as the first impression; the scenario section should serve as the detailed proof.

## 4. Information architecture

### Hero structure

```txt
Hero
├── Copy column
│   ├── Kicker
│   ├── Headline
│   ├── Subcopy
│   └── CTAs
└── Memory Weave stage
    ├── Woven thread field
    ├── Highlighted knots/intersections
    ├── Interaction panel
    └── Stage labels / legend
```

### Recommended headline

```txt
Izge reveals the hidden structure of organizational memory.
```

### Recommended subcopy

```txt
Izge reconstructs decisions, assumptions, contradictions, drift, and next actions from the artifacts your team already leaves behind.
```

### CTA guidance

Primary CTA:

```txt
Open the app
```

Secondary CTA:

```txt
Watch a decision come back to life
```

The secondary CTA should anchor to the existing scenario section.

## 5. Conceptual model

The hero should model one memory structure:

```ts
type WeaveThreadType = 'decision' | 'assumption' | 'constraint' | 'commitment' | 'outcome' | 'next_action'

type WeaveTensionType = 'normal' | 'contradiction' | 'drift' | 'supersession'

interface WeaveThread {
  id: string
  type: WeaveThreadType
  label: string
  evidenceLabel: string
  pathRole: 'horizontal' | 'vertical' | 'diagonal' | 'forward'
  state: 'quiet' | 'highlighted' | 'weakened' | 'tense'
}

interface WeaveKnot {
  id: string
  threadIds: string[]
  label: string
  tension: WeaveTensionType
  panelId: string
}

interface WeavePanel {
  id: string
  eyebrow: string
  title: string
  body: string
  evidenceNote: string
}
```

This can be represented directly in JavaScript constants for the static website. No backend data is needed for the hero.

## 6. Scenario data for the hero

Use a single concrete scenario aligned with the MVP demo:

```json
{
  "decision": "Delay self-serve launch to Q3",
  "assumption": "Activation instrumentation is not ready",
  "constraint": "Manual onboarding capacity is limited",
  "later_plan": "Reopen launch scope in late Q2",
  "contradiction": "Current direction conflicts with prior capacity reasoning",
  "next_action": "Schedule activation-readiness review before reopening launch scope",
  "evidence": [
    "roadmap_notes.md",
    "q2_planning.pdf",
    "launch_review.txt",
    "pasted meeting excerpt"
  ]
}
```

## 7. Interaction state machine

The hero should support five states.

```txt
calm_pattern
  -> decision_highlighted
  -> relations_visible
  -> contradiction_visible
  -> next_action_visible
```

### State details

| State | Visual | Copy |
| --- | --- | --- |
| `calm_pattern` | Full quiet weave, no dominant knot | Organizational memory has structure before it has answers. |
| `decision_highlighted` | One decision thread brightens | A decision is never alone. |
| `relations_visible` | Assumption/constraint/commitment intersections appear | It is shaped by assumptions, constraints, and commitments. |
| `contradiction_visible` | One knot turns amber/red-brown and pulses once | When history and current direction collide, Izge makes the tension visible. |
| `next_action_visible` | A forward path lights through the weave | Izge turns organizational memory into decision intelligence. |

### Input behavior

Desktop:

- Hover/focus a knot to open its panel.
- Click/tap a knot to pin the panel.
- If no interaction occurs, gently progress through the five states once.

Mobile:

- No precision-hover dependency.
- Use a vertical stepper below or above the weave.
- Tapping a step updates the weave state and panel.

Reduced motion:

- Show the final complete weave or a static stepped view.
- No auto-progression.
- No pulsing animation.

## 8. Visual architecture

### Preferred rendering approach

For the current static `website/` surface, prefer HTML/CSS/SVG over adding a new framework.

Recommended structure:

- SVG for thread paths and knots.
- HTML overlay for panels and labels.
- CSS custom properties for animation progress/state.
- Existing `memory-field.js` can manage state and interactions.

Avoid adding dependencies unless the website is intentionally migrated to React/Vite later.

### Thread rendering

Use SVG paths:

```html
<svg class="memory-weave" viewBox="0 0 900 640" aria-hidden="true">
  <path class="weave-thread thread-decision" d="..." />
  <path class="weave-thread thread-assumption" d="..." />
  <path class="weave-thread thread-constraint" d="..." />
  <path class="weave-thread thread-next-action" d="..." />
</svg>
```

Thread behavior:

- Base threads are low-opacity smoky off-white/green/brown.
- Highlighted threads brighten and gain soft shadow.
- Contradiction thread or knot shifts to amber/red-brown.
- Drift thread becomes lower-opacity, slightly broken/dashed, or visibly slack.

### Knot rendering

Use button-like HTML or SVG elements with accessible names:

```html
<button class="weave-knot knot-contradiction" aria-controls="weave-panel-contradiction">
  <span class="sr-only">Contradiction detected: Q3 delay conflicts with late Q2 launch plan</span>
</button>
```

The knot should be keyboard-focusable.

## 9. Motion architecture

Keep animations transform/opacity/stroke-dashoffset based.

Recommended animation primitives:

- `stroke-dashoffset` for path drawing.
- `opacity` for reveal.
- `transform` for slight tension/slack movement.
- `filter: drop-shadow()` sparingly for luminous knots.

Do not animate layout-affecting properties.

### Timing

- Initial weave reveal: 700–1000ms.
- State transition: 500–800ms.
- Contradiction pulse: one pulse, 900–1400ms, then settle.
- Next-action path: 800–1100ms draw.

## 10. Accessibility requirements

- Hero must have semantic text outside the visualization.
- Interactive knots must be reachable by keyboard.
- Active state must be visible on focus, not hover only.
- Contradiction cannot rely on red alone.
- Use `aria-live="polite"` only if panel copy changes without focus movement; otherwise avoid noisy announcements.
- Respect `prefers-reduced-motion`.
- Mobile layout must not require precise tapping on tiny knots.

## 11. Responsive behavior

### Desktop

- Two-column hero remains acceptable.
- Weave stage can occupy the right column or a wide visual band.
- Panels appear inside the stage, anchored near the active knot.

### Tablet

- Keep weave stage visible but reduce label density.
- Panel may become bottom-centered within the stage.

### Mobile

- Hero becomes vertical.
- Weave stage appears first or after headline depending on final design review.
- Use a text stepper; do not force users to tap tiny knots.

## 12. Integration with current page

Current elements to consider:

- `canvas#memory-field`: global background memory field.
- `.hero-stage`: current hero visual preview.
- `.memory-node`: current decision-intelligence cards.
- `.connector-web`: current SVG connectors.

Implementation options:

### Option A — Replace hero-stage internals

Keep `.hero-stage` container and replace its internal nodes/connectors with the weave.

Pros:

- Smallest page-layout change.
- Keeps current visual proportions.
- Lower risk.

Cons:

- Existing class names may become semantically stale unless renamed.

### Option B — Introduce `.memory-weave-stage`

Replace `.hero-stage` with a more semantic `.memory-weave-stage` block.

Pros:

- Cleaner long-term structure.
- Easier to reason about styles.

Cons:

- Larger diff.
- Requires careful regression testing.

Recommendation: **Option B** if implementation time allows; otherwise Option A for a safe MVP polish pass.

## 13. Acceptance criteria

Before implementation is considered complete:

- The hero presents Memory Weave as the primary visual metaphor.
- The visualization teaches the product, not just decorates the page.
- At least five conceptual states are represented.
- Hover/focus/tap interactions expose structured product meaning.
- Reduced motion users receive a stable, legible experience.
- Mobile users get a readable stepper rather than a tiny interactive diagram.
- The page still links clearly to `https://app.izge.dev`.
- No new unsupported product claims appear.
- No decorative Turkish cliché appears.
- Build/lint/static smoke checks pass.

## 14. QA checklist for future implementation

### Visual QA

- Hero appears bright/lit on first load.
- Weave is legible on dark background.
- Contradiction knot is noticeable but not alarmist.
- Next-action path feels like a resolution, not a generic success state.
- No purple AI-gradient look.

### Interaction QA

- Mouse hover changes active state.
- Keyboard focus changes active state.
- Tap works on mobile.
- Auto-progression does not fight user interaction.
- Active panel copy matches the selected knot/state.

### Accessibility QA

- Keyboard-only path works.
- Screen-reader labels are meaningful.
- Color contrast passes reasonable checks.
- Reduced motion mode disables pulsing/auto-progression.

### Regression QA

- Existing scenario section still works.
- Top-nav active-section highlighting still works.
- Bottom CTAs remain centered.
- Product trajectory layers still reveal correctly.
- Deployment script and app link remain unchanged.

## 15. Open review questions

Before coding, decide:

1. Should the current headline remain, or should we adopt “Izge reveals the hidden structure of organizational memory”?  
2. Should the weave auto-progress once, or only respond to hover/tap/scroll?  
3. Should Turkish naming appear visibly as “Hafıza Dokusu,” or stay as internal design vocabulary?  
4. Should the secondary CTA jump to the scenario section or stay as “Read the belief system”?  
5. Should the first implementation be a safe static SVG/HTML version, or should we later migrate the website to React for richer interaction?

## 16. Recommended implementation sequence after approval

1. Lock final copy and interaction states.
2. Sketch SVG thread paths and knot positions.
3. Replace/evolve hero visual markup.
4. Add CSS states and reduced-motion rules.
5. Add JS state manager for hover/focus/tap/auto-progression.
6. Test desktop/mobile/reduced motion.
7. Run build/lint/static smoke.
8. Deploy with `deploy/redeploy-ec2.sh`.
