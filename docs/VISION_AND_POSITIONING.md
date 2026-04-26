# VISION_AND_POSITIONING.md
## Izge

## Product definition
Izge is a **local-first institutional memory and decision intelligence system**. It reconstructs what an organization decided, why it decided it, what assumptions and constraints shaped those decisions, what later contradicted them, what has drifted, and what the team should do next.

It is not:
- internal search
- chat over files
- a PM copilot
- a generic agent-memory framework
- generic AI SaaS

It is a system for turning fragmented organizational history into usable, inspectable decision intelligence.

## The real problem
Organizations rarely fail because information is missing. They fail because memory is broken.

Critical context gets scattered across roadmap notes, weekly updates, logs, reports, presentations, postmortems, and ad hoc documents. Teams reopen old questions without knowing it. New proposals quietly conflict with prior decisions. Assumptions continue shaping execution after reality has changed.

Most tools store or retrieve documents. Izge reconstructs **institutional memory**.

## Product thesis
Organizations need a system that can answer:
- what did we decide,
- why did we decide it,
- what assumptions and constraints shaped it,
- what changed later,
- what now contradicts prior direction,
- which assumptions have drifted,
- what should we do next,
- and what evidence supports that conclusion.

## Wedge
The MVP wedge is **product and roadmap history**:
- strategy notes
- roadmap documents
- planning notes
- weekly updates
- decision logs
- review notes
- retrospectives
- product-related postmortems
- member-submitted reports and presentations

This wedge is narrow enough to build and broad enough to show real organizational memory failure.

## Why now
Three shifts make Izge timely:
1. Organizations already have large amounts of digital history, but still reason over it poorly.
2. Local/on-prem model runtimes make private reasoning over sensitive internal data practical.
3. Teams are tired of tool sprawl and want products that reduce confusion rather than create more of it.

## Positioning sentence
Izge is a local-first system that reconstructs organizational decision history, reveals contradiction and assumption drift, and helps teams choose evidence-backed next actions.

## Product trajectory
Izge evolves across three layers:

### 1. Institution Memory Engine
The core. Izge reconstructs decisions, assumptions, constraints, commitments, outcomes, contradictions, and supersessions from organizational artifacts.

### 2. Decision Guidance Layer
On top of reconstructed memory, Izge recommends grounded next actions based on historical evidence, unresolved tensions, and changing assumptions.

### 3. Later bounded Scenario Support
Once memory reconstruction and guidance are strong enough, Izge can compare bounded future paths and surface likely consequences of repeating or reversing historical patterns.

## Operating model
For the MVP, Izge is local-first in the following sense:
- storage remains inside company-controlled infrastructure,
- heavy reasoning runs on a company-controlled central inference node,
- external hosted AI is not the primary reasoning layer,
- future lightweight edge-side models on employee devices are optional, not required for MVP.

## Core product philosophy
- Memory before magic
- History before speculation
- Evidence before confidence
- Structure before summary
- Local-first trust from day one

## Final rule
Izge wins only if users feel:

> “This system helps us stop forgetting why we do things, and helps us make better decisions because of that.”
