# Memory Weave Metaphor Spec

Status: adopted direction  
Scope: public landing-page metaphor, brand/narrative system, hero interaction  
Implementation status: initial landing-page hero implementation completed in `website/`

## 1. Recommendation

Use **The Memory Weave / Hafıza Dokusu** as Izge's primary landing-page metaphor.

This is the strongest metaphor because it is native to the product instead of being an external visual theme. Izge reconstructs decisions from artifacts by exposing relationships, lineage, contradictions, drift, and next actions. A weave expresses exactly that: individual threads become meaningful only through their tension, crossings, pattern, and continuity.

The metaphor should not be treated as a decorative background. It should become a miniature explanation of Izge's category.

## 2. Why this fits Izge

| Izge concept | Weave expression |
| --- | --- |
| Decision lineage | A continuous thread through time |
| Assumption | A supporting thread that gives the decision shape |
| Constraint | A taut boundary thread that limits motion |
| Commitment | A tied/knot-like relation between memory objects |
| Outcome | A thread endpoint or changed pattern segment |
| Contradiction | Threads crossing under visible tension |
| Assumption drift | A thread losing tension, fraying, fading, or slipping out of alignment |
| Supersession | A newer layer woven over an older path while the prior layer remains inspectable |
| Evidence | The fiber itself: the material from which memory is reconstructed |
| Next action | A forward path illuminated through the weave |

The current positioning says Izge is not search, chat over files, a PM copilot, or a roadmap assistant. The weave makes that visible: the product is not retrieving isolated notes; it is reconstructing the hidden structure connecting them.

## 3. Turkish-rooted, not folkloric

The metaphor may draw from **kilim / dokuma / motif logic**, but the execution must avoid ornamental cliché.

### Use the cultural logic

- Woven structure.
- Patterns as carriers of memory.
- Meaning encoded through relation, repetition, interruption, and tension.
- Hidden structure becoming legible.
- Continuity across time.

### Avoid superficial decoration

Do not use:

- Ottoman pattern wallpaper.
- Tourism-branding motifs.
- Literal carpet/kilim texture as background ornament.
- Bright folk-art color palettes.
- Decorative motifs unrelated to product logic.
- A “Turkish pattern generator behind SaaS cards” look.

The result should feel **modern, abstract, strategic, and high-tech**, with Turkish resonance embedded in the system logic rather than pasted onto the surface.

## 4. Emotional target

The user should feel:

- “This product sees structure where others see documents.”
- “My organization's forgotten rationale can become visible again.”
- “Contradictions are not gotchas; they are tensions in the memory fabric.”
- “Izge is serious, evidence-grounded, and memorable.”

The interaction should be calm, precise, and intelligent. It should not feel like a flashy AI animation.

## 5. Narrative role on the landing page

The hero should teach Izge in roughly 20 seconds.

### State 1 — calm pattern

A semi-abstract woven memory field appears. It looks structured, quiet, and alive.

Message:

> Organizational memory has structure before it has answers.

Purpose: establish intrigue without over-explaining.

### State 2 — one thread highlighted

One decision thread becomes visible.

Message:

> A decision is never alone.

Purpose: show that a decision has context, not just a title.

### State 3 — intersecting support threads

Assumption, constraint, commitment, and outcome threads connect to the decision.

Message:

> It is shaped by assumptions, constraints, commitments, and outcomes.

Purpose: communicate Izge's memory object model.

### State 4 — tension/contradiction emerges

One knot or crossing intensifies amber/red-brown. A contradiction panel appears.

Message:

> When history and current direction collide, Izge makes the tension visible.

Purpose: teach contradiction analysis without making the product feel adversarial.

### State 5 — forward path lights

A path through the weave sharpens into a next-action recommendation.

Message:

> Izge turns organizational memory into decision intelligence.

Purpose: close the metaphor by connecting reconstruction to action.

## 6. Hero content model

The hero interaction should use one concrete product scenario, not abstract labels only.

Recommended sample scenario:

- Decision: `Delay self-serve launch to Q3`
- Assumption: `Activation instrumentation is not ready`
- Constraint: `Manual onboarding capacity is limited`
- Later plan: `Reopen launch scope in late Q2`
- Tension: `Current direction conflicts with prior capacity reasoning`
- Next action: `Schedule activation-readiness review before reopening launch scope`
- Evidence: `Reconstructed from roadmap_notes.md, q2_planning.pdf, launch_review.txt, and meeting excerpt`

This keeps the hero aligned with the current MVP demo packet and avoids inventing new product features.

## 7. Copy direction

### Primary hero headline candidates

Strongest:

> Izge reveals the hidden structure of organizational memory.

Alternative:

> Your organization is not missing documents. It is missing memory.

Alternative:

> See how decisions connect, conflict, drift, and shape what comes next.

### Subcopy direction

> Izge reconstructs decisions, assumptions, contradictions, drift, and next actions from the artifacts your team already leaves behind.

### Interaction labels

- `Decision thread`
- `Assumption support`
- `Constraint boundary`
- `Commitment knot`
- `Contradiction tension`
- `Evidence fiber`
- `Next-action path`

### Panel copy example

```txt
Decision
Delay self-serve launch to Q3

Why it mattered
Activation instrumentation and manual onboarding capacity were not ready.

What changed later
Leadership reopened launch scope for late Q2.

Tension detected
Current direction conflicts with prior capacity reasoning.

Izge's role
Reconstructed from 4 artifacts with evidence-linked memory objects.
```

## 8. Visual direction

### Palette

Use the existing Izge palette:

- black
- dark navy
- graphite
- dark green
- dark brown
- smoky off-white
- muted amber / red-brown for contradiction

Avoid:

- purple AI gradients
- bright SaaS blues
- rainbow thread palettes
- decorative folk colors

### Texture

The weave should be mostly vector/line-based, not textile-realistic.

Acceptable texture:

- subtle grain
- fine thread-like line weight variance
- smoky off-white highlights
- slight tension distortion

Avoid texture:

- photo fabric
- rug realism
- ornate motif fills
- skeuomorphic fibers

### Motion

Motion should feel like uncovering evidence:

- slow thread tension shifts
- subtle pulsing at intersections
- highlighted path drawing forward
- contradiction knot intensifies once, then settles
- drift thread weakens/frays subtly

Avoid:

- constant restless motion
- particle explosions
- bouncy UI motion
- carousel/slideshow pacing

## 9. Accessibility and reduced motion

The metaphor must remain legible without motion.

Requirements:

- All interactive knots need keyboard-focusable equivalents if clickable.
- Each state should have text that explains what the visual means.
- Do not rely on red alone for contradiction; use shape/tension/label as well.
- Respect `prefers-reduced-motion` by showing a static but fully explained state.
- Maintain contrast against the dark background.
- Avoid tiny labels inside the visualization on mobile.

## 10. Relationship to existing landing page

The current landing page already has:

- a cinematic dark direction,
- a scroll-driven scenario section,
- a memory-field canvas,
- a decision-lineage preview in the hero.

The Memory Weave should evolve the existing hero, not create a second competing metaphor.

Recommended approach:

1. Replace or upgrade the current hero visual centerpiece with the Memory Weave.
2. Keep the scroll-driven “Watch a decision come back to life” section as the deeper product story.
3. Use the weave hero to teach the category quickly; use the scenario section to prove the workflow.

## 11. Guardrails

The Memory Weave must not imply capabilities outside the MVP.

Do not suggest:

- automatic company-wide omniscience,
- predictive simulation as a current feature,
- autonomous decision-making,
- integrations that do not exist,
- generic knowledge graph search,
- magical “AI remembers everything” claims.

Stay within:

- decision lineage,
- contradiction analysis,
- assumption drift,
- next-action guidance,
- evidence-grounded reconstruction from artifacts.

## 12. Evaluation criteria

The metaphor is successful if a first-time viewer can answer:

1. What does Izge do?  
   It reconstructs the structure of organizational decision memory.
2. Why is it different from search/chat?  
   It shows relationships, tensions, drift, and grounded next actions instead of isolated answers.
3. What do the visuals mean?  
   Threads are memory objects; intersections are relationships; tension reveals contradiction/drift.
4. Why is it memorable?  
   The product has a specific metaphor, not generic AI dashboard imagery.

## 13. Recommendation for review

Adopt **Memory Weave / Hafıza Dokusu** as the primary Izge metaphor.

Keep **Trace Field / İz Haritası** as a secondary vocabulary for smaller UI moments, especially audit trails, evidence trails, and provenance paths. Do not use Memory Faultline as the primary metaphor because it overweights conflict and underweights continuity.
