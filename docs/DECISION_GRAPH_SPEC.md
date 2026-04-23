# DECISION_GRAPH_SPEC.md
## Institutional Memory Graph Design

## Purpose
The decision graph is the core memory representation.

It represents:
- decisions,
- proposals,
- assumptions,
- constraints,
- outcomes,
- commitments,
- conflicts,
- timelines,
- organizational entities.

## Why a graph
Institutional memory is not linear.
The same decision may be:
- mentioned across many documents,
- rooted in several assumptions,
- constrained by older events,
- contradicted by newer plans,
- owned by multiple actors.

## Required node types
- Artifact
- Decision
- Proposal
- Assumption
- Constraint
- Outcome
- Commitment
- Question
- Person
- Team
- Project
- Initiative
- Policy
- Incident
- Metric

## Required edge types
- MENTIONED_IN
- DECIDED_BY
- SUPPORTED_BY
- CONSTRAINED_BY
- BASED_ON
- RESULTED_IN
- CONTRADICTS
- SUPERSEDES
- REOPENS
- OWNS
- RELATES_TO
- IMPACTS
- DEPENDS_ON
- ADDRESSES
- LEAVES_OPEN
- DERIVED_FROM

## V1 rule
Keep the graph semantically useful before making it visually fancy.
