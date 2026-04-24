---
skill_id: render_graph_timeline_inspection_ui
version: "1.1"
priority: "P1"
source_projects: ["TrustGraph", "Graphiti", "Neo4j GraphRAG", "React Flow"]
consumes: ["graph_summary_api", "memory_object_api"]
produces: ["graph_view", "timeline_view", "trace_view"]
depends_on: ["persist_decision_graph_sqlite", "compose_permission_aware_answers_and_audit"]
---

# Graph and Timeline Inspection UI

## Short description
Render Izge's memory graph as a timeline-first inspection surface with graph neighborhood exploration, evidence drill-down, and query-trace inspection rather than as a decorative force-directed graph.

## Why this skill exists
The main UI lesson from the researched systems is negative: graph UIs become expensive wallpaper if they are not anchored to evidence and task flow. Izge's core user need is historical reconstruction, so the primary workflow should begin with time and causality, not with freeform graph panning.

## Primary product stance

### Timeline first
The default view should help the user answer:
- what happened when,
- what changed,
- what contradicted what,
- and what evidence supports that interpretation

### Graph second
The graph is for neighborhood inspection:
- where did this decision come from,
- what assumptions support it,
- what outcome contradicted it,
- and what else does it connect to

### Trace always available
Any answer or graph selection should allow the user to inspect:
- seeds
- explored edges
- selected evidence
- omitted evidence counts

This is the TrustGraph explainability lesson translated into Izge's UI.

## Core UI surfaces

### Timeline rail
Ordered cards for:
- decisions
- proposals
- assumptions
- constraints
- outcomes
- commitments
- contradictions
- supersessions

Each card should show:
- object kind
- short factual label
- observed date
- status badge such as `active`, `superseded`, `contradicted`, `open`

### Detail drawer
When a timeline item or graph node is selected, show:
- canonical text
- evidence snippets
- related objects
- contradiction or supersession state
- actor and project metadata

### Graph neighborhood view
Use React Flow for controlled neighborhood expansion, not full graph dumps.

The graph should request:
- one selected object,
- immediate neighbors,
- and optionally second-hop expansion

### Query trace panel
For answer inspection, show:
- route class
- seed objects
- explored edges
- selected evidence packets
- omission counts
- uncertainty notes

## Borrowed know-how by project

### From TrustGraph
- Explainability should be inspectable in the product, not hidden in logs.
- Provenance chains should let the user walk from selected edge to chunk to document.

### From Graphiti
- Temporal changes matter more than static topology.
- Validity windows and supersession are worth displaying explicitly.

### From Neo4j GraphRAG
- Lexical graph and evidence chunks should stay connected to semantic objects.
- Result formatting and partial-failure awareness should influence UI state.

## Implementation blueprint

### Step 1. Build a timeline-centered API contract
Return compact cards with:
- `object_id`
- `kind`
- `title`
- `observed_at`
- `status`
- `primary_evidence_chunk_id`
- `related_counts`

### Step 2. Add graph neighborhood endpoints
The graph endpoint should accept:
- `center_object_id`
- `max_hops`
- `edge_types`
- `time_window`

Do not send the whole workspace graph to the client.

### Step 3. Add evidence and trace deep links
Every node and edge should deep-link to:
- evidence drawer
- source artifact view
- query trace step if the object came from a query result

### Step 4. Show uncertainty honestly
Surface:
- hidden relation counts
- omitted evidence note
- parser coverage gaps
- extraction-confidence warnings

## Minimal reproducible code snippets

```tsx
import { ReactFlow, Background, Controls, MiniMap } from "@xyflow/react";

export function DecisionGraph({ nodes, edges }) {
  return (
    <div style={{ width: "100%", height: 480 }}>
      <ReactFlow nodes={nodes} edges={edges} fitView>
        <MiniMap />
        <Controls />
        <Background />
      </ReactFlow>
    </div>
  );
}
```

## Integration notes
- Keep timeline, detail drawer, and graph selection synchronized by shared `object_id`.
- Fetch evidence server-side and permission-filter it before sending to the browser.
- Provide a stable URL model such as `/objects/:object_id` and `/queries/:query_run_id` so inspection states are linkable.

## Anti-patterns to avoid
- Force-directed graph as the primary landing view.
- Sending unauthorized nodes to the browser and hiding them client-side.
- Making contradiction visible only as a color without paired evidence.
- Rendering traces as giant JSON dumps instead of ordered stages.

## Testing / validation steps
- Snapshot tests for timeline card states and hidden-edge suppression.
- Interaction tests for graph-to-detail and answer-to-trace deep linking.
- Accessibility checks for keyboard navigation, badges, and evidence drawers.
- Visual regression tests for dense timelines and neighborhood graphs.

## Performance considerations
- Limit graph neighborhoods server-side.
- Paginate timeline segments for large workspaces.
- Memoize client transforms for nodes and edges, but keep the API payloads intentionally small.

## Security / privacy / licensing notes
- Permission filtering must happen before serialization.
- React Flow is MIT-licensed; confirm compatibility with the frontend package policy.

## References
- TrustGraph explainability and provenance inspection surfaces
- Graphiti temporal graph interpretation
- Neo4j GraphRAG lexical-plus-semantic context inspection
