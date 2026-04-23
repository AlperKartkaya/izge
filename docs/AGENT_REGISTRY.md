# AGENT_REGISTRY.md
## Specialist Agents for Institution Memory Engine

## Product rule
Agents are implementation tools, not the product itself.

## Recommended V1 agents
### Artifact Parsing Agent
Classifies artifact type and helps select parsing strategy.

### Memory Extraction Agent
Extracts decisions, assumptions, constraints, commitments, outcomes, and unresolved questions.

### Entity Resolution Agent
Resolves aliases, merges duplicate references, and links mentions across artifacts.

### Contradiction Detection Agent
Compares relevant memory objects and identifies direct or partial contradictions.

### Assumption Drift Agent
Identifies assumptions that appear invalid, outdated, or weakened.

### Guidance Agent
Answers decision-guidance questions and recommends next steps based on graph evidence.

### Result Synthesis Agent
Composes final answers with evidence references and honest uncertainty.

## Anti-patterns
Avoid:
- general super-agent,
- overlapping vague agents,
- theatrical agent conversations,
- hidden agent loops with no traceability.
