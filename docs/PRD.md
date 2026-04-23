# PRD.md
## Product Requirements Document
## Institution Memory Engine

## Overview
Institution Memory Engine is a local-first AI system that ingests internal organizational artifacts and reconstructs decision history, contradictions, assumptions, constraints, and outcomes in order to support better present-day decisions.

## Primary problem
Organizations suffer from institutional memory failure:
- repeated debates,
- forgotten rationale,
- conflicting commitments,
- stale assumptions,
- postmortem lessons that never become embedded.

Current tools mostly provide storage or retrieval, not memory and reasoning.

## Product goals
### Primary goals
- reconstruct decision history from messy internal artifacts,
- map decisions to rationale, constraints, and outcomes,
- detect contradictions across time and across sources,
- detect stale assumptions,
- recommend better next actions grounded in historical evidence.

### Secondary goals
- support local-first deployment,
- create a clean demonstration of AI-native organizational reasoning,
- establish a memory graph that can support future simulation and decision engines.

## Non-goals
V1 is not:
- a workflow builder,
- a general enterprise search product,
- a generic assistant for all internal work,
- a system that fully integrates every data source,
- a broad simulation engine,
- a full governance platform.

## Core use-cases
- decision lineage
- contradiction detection
- stale assumption detection
- forward guidance

## Users
Primary users:
- product managers,
- founders,
- operations leads,
- internal strategy users,
- program managers,
- technical leads.

## Release criteria
V1 is acceptable when:
- it ingests real internal artifacts,
- it produces a usable decision graph,
- it can answer historical decision questions,
- it can detect meaningful contradictions,
- it can recommend next actions with evidence,
- it remains clearly distinct from basic document search.
