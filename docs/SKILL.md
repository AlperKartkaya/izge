# SKILL.md
## Skill: Building the Institution Memory Engine Correctly

## Product truth
This product is not about storing knowledge.
It is about reconstructing organizational memory.

It is not enough to:
- retrieve documents,
- summarize notes,
- answer questions vaguely.

The product must:
- identify decisions,
- identify rationale,
- track assumptions,
- detect contradictions,
- identify stale assumptions,
- produce grounded next-step guidance.

## Main implementation mindset
Always think in this sequence:
1. What memory objects are present?
2. What relationships connect them?
3. What tensions or contradictions exist?
4. What changed over time?
5. Which assumptions are weakening or invalid?
6. What action follows from that history?

## Guardrails
- do not drift into generic RAG
- do not become a vague knowledge graph demo
- do not overuse agents
- do not invent unsupported historical narratives
- do not overclaim certainty

## Final rule
At every design choice, ask:
Does this make the system better at reconstructing organizational memory and guiding better decisions from that history?
