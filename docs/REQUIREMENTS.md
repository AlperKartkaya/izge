# Requirements Specification

## Functional Requirements (FR)

### 1. Workspace, roles, and access control

**FR-1** The system shall allow an authorized user to create and access a workspace.

**FR-2** The system shall support at minimum two user roles: **Admin** and **Member**.

**FR-3** The system shall allow an Admin to manage workspace users and role assignments.

**FR-4** The system shall enforce artifact-, evidence-, and output-level access restrictions based on user permissions.

**FR-5** The system shall prevent unauthorized users from viewing restricted artifacts, evidence spans, or outputs derived from restricted evidence.

**FR-6** The system shall allow Members to contribute artifacts to the workspace, subject to the system’s access and processing rules.

---

### 2. Local-first architecture and processing

**FR-7** The system shall operate primarily on company-controlled infrastructure for storage and reasoning.

**FR-8** The system shall support a central company-controlled inference node for heavy reasoning and memory-processing tasks.

**FR-9** The system should allow future support for lightweight edge-side reasoning on employee devices using smaller local models.

**FR-10** The system shall not require external hosted AI services as its primary reasoning layer in the MVP.

### 2A. MVP LLM integration and inference boundaries

The MVP may use local LLMs, but only inside a bounded, company-controlled inference architecture. These requirements define what the MVP must support regardless of the current implementation state.

**LLM-MVP-1** The MVP shall support a centrally configured, company-controlled local inference gateway for LLM-assisted work, with no dependency on external hosted AI services for the primary demo path.

**LLM-MVP-2** The MVP shall expose configuration for the local inference gateway, model name, timeout, and independent feature flags for LLM-assisted extraction, query routing, answer synthesis, and proactive-signal explanation.

**LLM-MVP-3** The MVP shall treat deterministic storage, permission filtering, artifact review status, graph construction, signal classification, and persistence as the authority of record; LLM output must not directly create trusted signals, graph edges, or final persisted memory without validation.

**LLM-MVP-4** LLM-assisted structured extraction shall return schema-validated memory candidates for the locked MVP object types: **Decision, Assumption, Constraint, Outcome, and Commitment**.

**LLM-MVP-5** If LLM-assisted extraction fails, times out, returns malformed JSON, or fails schema validation, the system shall fall back to deterministic extraction and clearly preserve fallback provenance.

**LLM-MVP-6** LLM-assisted query routing shall be limited to intent classification among the locked MVP reasoning modes; deterministic graph reasoning shall still select evidence and construct the answer packet.

**LLM-MVP-7** LLM-assisted answer synthesis shall be limited to rewriting the final response from an already-selected deterministic evidence packet; it shall not introduce new claims, citations, actions, or hidden evidence.

**LLM-MVP-8** LLM-assisted proactive-signal explanation shall be limited to wording and guidance for signals already detected by deterministic graph analysis; it shall not alter signal type, urgency, evidence support, or persistence boundaries.

**LLM-MVP-9** All LLM inputs shall be permission-aware and review-aware before prompt construction; restricted, hidden, or admin-rejected artifact content shall not be sent to the local inference gateway for a reader who cannot use that evidence.

**LLM-MVP-10** All LLM outputs used in the MVP shall be schema-validated, citation-bounded to provided artifact or memory IDs, and fail closed to deterministic output when validation fails.

**LLM-MVP-11** The product UI or trace surfaces shall identify when LLM assistance was applied, disabled, or bypassed by fallback, while preserving the distinction between deterministic reasoning and LLM wording assistance.

**LLM-MVP-12** The MVP shall not assume edge-side or employee-local model participation. Edge-side inference remains a future trajectory and must not be required for MVP correctness or demo readiness.

### 2B. MVP deployment interpretation

**DEPLOY-MVP-1** The product shall define **local-first** as organization-controlled storage, memory, and inference, not as a requirement that every employee runs a desktop or localhost app.

**DEPLOY-MVP-2** The primary customer architecture shall be self-hosted/customer-controlled deployment at an internal or customer-controlled URL, with customer-controlled backend, artifact storage, database, and local/private LLM gateway.

**DEPLOY-MVP-3** The jury/demo architecture shall use `https://app.izge.dev` as an Izge-controlled deployment backed by EC2 storage and EC2-local or Izge-private LLM inference.

**DEPLOY-MVP-4** Izge-managed single-tenant deployment may be supported as a pilot or commercial bridge when a customer does not want to operate infrastructure directly.

**DEPLOY-MVP-5** Generic multi-tenant SaaS shall not be the category-defining default for the MVP because it weakens the local-first institutional-memory trust promise.

**DEPLOY-MVP-6** Employee-local or edge-side LLM participation shall remain future optional capability and shall not be required for the MVP, jury demo, or initial customer deployment.

---

### 3. Artifact intake and ingestion

**FR-11** The system shall allow users to upload supported source artifacts into the workspace.

**FR-12** The system shall allow users to submit pasted text as a source artifact.

**FR-13** The system shall support at minimum the following input types in the MVP: **Markdown, plain text, PDF, and pasted text**.

**FR-14** The system shall store uploaded artifacts locally within company-controlled infrastructure.

**FR-15** The system shall parse and normalize the textual content of supported artifacts.

**FR-16** The system shall split ingested artifacts into ordered chunks suitable for downstream extraction and reasoning.

**FR-17** The system shall allow an authorized user to trigger ingestion for newly submitted artifacts.

**FR-18** The system shall expose ingestion status information for each processed artifact or ingestion run.

**FR-19** The system shall support artifact submission by Members in the form of logs, reports, presentations, notes, or similar organizational records.

**FR-20** The system should support an intake status model that distinguishes between newly submitted, processed, and optionally reviewed artifacts.

---

### 4. Structured memory extraction

**FR-21** The system shall extract structured memory objects from ingested artifacts.

**FR-22** The system shall support at minimum the following memory object types: **Decision, Assumption, Constraint, Outcome, and Commitment**.

**FR-23** The system shall attach each extracted memory object to one or more source artifacts.

**FR-24** The system shall attach each extracted memory object to source chunk references and/or evidence spans.

**FR-25** The system shall persist normalized text fields for extracted memory objects.

**FR-26** The system shall persist confidence information for extracted memory objects.

**FR-27** The system shall persist timestamps when they are explicitly present or reasonably inferable from source material.

**FR-28** The system should categorize ingested artifacts and extracted memory objects in a way that supports later retrieval and reasoning.

---

### 5. Graph and relationship modeling

**FR-29** The system shall build an explicit graph or graph-like relationship model from extracted memory objects.

**FR-30** The system shall represent relationships between memory objects as typed links.

**FR-31** The system shall support at minimum relationship types needed for decision reasoning, including **BASED_ON, CONSTRAINED_BY, RESULTED_IN, CONTRADICTS, SUPERSEDES, and RELATES_TO**.

**FR-32** The system shall link graph relationships to supporting evidence where available.

**FR-33** The system shall allow related memory objects to be inspected through graph, timeline, or detail views.

**FR-34** The system should preserve continuity between older and newer related artifacts, including where decisions are reopened, revised, superseded, or contradicted.

---

### 6. Query and reasoning

**FR-35** The system shall allow users to submit natural-language questions about organizational history.

**FR-36** The system shall classify user questions into one of the locked MVP reasoning modes.

**FR-37** The system shall support at minimum the following reasoning modes:
- **Decision lineage**
- **Contradiction analysis**
- **Assumption drift detection**
- **Next-action guidance**

**FR-38** The system shall answer decision-lineage questions by identifying what was decided, why it was decided, and which assumptions, constraints, outcomes, and commitments were related.

**FR-39** The system shall answer contradiction-analysis questions by identifying conflicts or tensions between past and current decisions, commitments, plans, or assumptions.

**FR-40** The system shall answer assumption-drift questions by identifying assumptions that appear weakened, invalidated, or unsupported by later evidence.

**FR-41** The system shall answer next-action-guidance questions by recommending a grounded next step based on historical evidence and unresolved tensions.

**FR-42** The system shall generate responses using structured memory objects, graph state, and evidence rather than relying only on raw document text.

---

### 7. Ingestion-time intelligence and proactive detection

**FR-43** The system shall evaluate newly ingested artifacts against existing organizational memory.

**FR-44** The system shall detect likely contradictions between a newly submitted artifact and existing decisions, commitments, assumptions, or plans when supported by available evidence.

**FR-45** The system shall detect likely assumption drift introduced or revealed by a newly submitted artifact when supported by available evidence.

**FR-46** The system shall detect likely supersession or reopening of previous decisions when a new artifact materially changes prior direction.

**FR-47** The system shall generate a grounded next-action suggestion when a newly submitted artifact introduces a meaningful contradiction, drift signal, or supersession event.

**FR-48** The system shall associate such proactive detections with supporting evidence and related memory objects.

---

### 8. Signals and overview surfaces

**FR-49** The system shall provide a workspace-level surface showing active contradictions.

**FR-50** The system shall provide a workspace-level surface showing active assumption-drift signals.

**FR-51** The system shall provide a workspace-level surface showing recommended next actions derived from current organizational memory.

**FR-52** The system shall allow these signals to be inspected individually with supporting reasoning and evidence.

**FR-53** The system should provide an urgency or priority signal for surfaced contradictions, drift items, or recommended next actions.

**FR-54** The system should provide an uncertainty or confidence indicator for surfaced contradictions, drift items, or recommended next actions.

---

### 9. Result presentation and inspectability

**FR-55** The system shall present a direct answer for each user query.

**FR-56** The system shall present a “why this answer” explanation for each query result.

**FR-57** The system shall present supporting evidence references for major claims in each query result.

**FR-58** The system shall present related memory objects alongside the query result where relevant.

**FR-59** The system shall present contradictions or tensions where relevant.

**FR-60** The system shall present assumption drift where relevant.

**FR-61** The system shall present recommended next actions where relevant.

**FR-62** The system shall present uncertainty or missing-context notes when confidence is limited or evidence is incomplete.

**FR-63** The system shall allow users to drill down from a result into supporting evidence, source artifacts, and related memory objects.

---

### 10. Admin and operational visibility

**FR-64** The system shall provide an admin-visible view of uploaded artifacts and their processing state.

**FR-65** The system shall provide a view of extracted memory objects or summaries derived from ingestion.

**FR-66** The system shall provide a graph summary, contradiction summary, drift summary, or similar workspace-level reasoning overview.

**FR-67** The system shall provide user and permission management functions for Admin users.

**FR-68** The system shall provide operational visibility into whether the workspace is ready for reasoning or demo use.

---

### 11. Audit and traceability

**FR-69** The system shall record audit events for user sign-in, artifact upload, pasted text submission, ingestion execution, query execution, permission changes, and graph/memory updates.

**FR-70** The system shall associate audit events with timestamps and relevant actors where applicable.

**FR-71** The system shall make audit information visible to Admin users.

---

### 12. Continuity and anti-duplication support

**FR-72** The system shall retain previously submitted reports, logs, and summaries in a way that allows them to influence future reasoning.

**FR-73** The system should surface prior relevant work when a new artifact or inquiry overlaps substantially with earlier work.

**FR-74** The system should support continuity use cases such as preventing repeated work across intern cycles, role transitions, or recurring projects by surfacing relevant historical artifacts, decisions, and outcomes.

**FR-75** The system should identify when newly submitted work substantially overlaps with earlier work and present relevant prior context to the user or Admin.

---

# Non-Functional Requirements (NFR)

## 1. Product identity and category integrity

**NFR-1** The system shall preserve its identity as an **institutional memory and decision intelligence product**, rather than behaving like a generic chatbot or enterprise search tool.

**NFR-2** The system shall present outputs in a structured, inspectable form rather than as unbounded conversational prose.

**NFR-3** The system should make its reasoning feel evidence-backed, disciplined, and product-specific.

**NFR-4** The system should remain clearly differentiated from “chat over files,” “internal search,” and “PM copilot” patterns.

**NFR-5** The system shall not let visual, interaction, or output patterns undermine the product’s category as institutional memory plus decision intelligence.

---

## 2. Usability and clarity

**NFR-6** The system shall provide a user experience that makes the four core reasoning modes understandable to non-technical professional users.

**NFR-7** The system should minimize ambiguity about what kinds of questions can be asked and what kinds of answers will be returned.

**NFR-8** The system should allow users to move from answer to evidence to source with minimal friction.

**NFR-9** The system should make contradictions, drift, lineage, and guidance visually and structurally legible.

**NFR-10** The system should make intake, ingestion, and workspace state understandable to Admin users without requiring developer interpretation.

---

## 3. Trust, transparency, and explainability

**NFR-11** The system shall not make major historical claims without evidence references.

**NFR-12** The system shall preserve provenance for extracted memory objects and relationships.

**NFR-13** The system shall make uncertainty visible when evidence is partial, conflicting, or weak.

**NFR-14** The system should make its outputs inspectable enough that a user can understand why the system reached a conclusion.

**NFR-15** The system should make proactive detections on newly ingested artifacts understandable and justifiable, rather than magical or opaque.

---

## 4. Security, privacy, and locality

**NFR-16** The system shall operate in a **local-first** manner for the MVP.

**NFR-17** The system shall store organizational artifacts and memory data within company-controlled infrastructure.

**NFR-18** The system shall use company-controlled inference infrastructure as the primary reasoning layer for the MVP.

**NFR-19** The system shall enforce role-based and permission-aware access to artifacts, evidence, and derived outputs.

**NFR-20** The system shall avoid exposing restricted information through summaries, query outputs, or linked evidence.

**NFR-21** The system should support secure handling of sensitive internal organizational data.

**NFR-22** The system should be architected so that future optional edge-side reasoning on employee devices can be introduced without breaking the core local-first model.

---

## 5. Performance and responsiveness

**NFR-23** The system should return query results within a reasonable interactive time for MVP-scale workspaces.

**NFR-24** The system should provide visible status feedback during ingestion and long-running operations.

**NFR-25** The system should remain responsive enough for a smooth MVP demo experience.

**NFR-26** The system should degrade gracefully when parsing, extraction, or reasoning takes longer than expected.

**NFR-27** The system should surface proactive contradiction/drift detections from new artifact ingestion within a practical operational time window.

---

## 6. Reliability and correctness

**NFR-28** The system shall behave deterministically enough that repeated use on the same artifact set produces broadly stable structural outputs.

**NFR-29** The system should minimize hallucinated decisions, assumptions, contradictions, drift signals, and recommendations.

**NFR-30** The system should prefer omission and uncertainty over unsupported certainty.

**NFR-31** The system shall fail safely when parsing, extraction, or reasoning cannot be completed.

**NFR-32** The system should avoid surfacing weak or spurious contradictions simply because textual overlap exists.

---

## 7. Maintainability and extensibility

**NFR-33** The system shall be organized in a modular way that separates ingestion, extraction, graph construction, proactive detection, reasoning, and presentation concerns.

**NFR-34** The system should be extensible to additional input sources, richer governance, and bounded scenario support in later versions.

**NFR-35** The system should allow future migration from MVP-scale storage choices to more scalable infrastructure without rewriting the product logic from scratch.

**NFR-36** The system should allow future refinement of reasoning quality without requiring a redesign of the whole application.

**NFR-37** The system should allow future support for more sophisticated intake workflows, approval/review states, and edge-model participation without disrupting the current MVP flow.

---

## 8. Accessibility and interface quality

**NFR-38** The system shall maintain readable contrast and accessible interaction states.

**NFR-39** The system shall support keyboard-accessible core navigation and interaction flows.

**NFR-40** The system should respect reduced-motion preferences where animations or motion effects are used.

**NFR-41** The system should preserve readability and clarity across major screen sizes used in MVP demos and desktop workflows.

---

## 9. Demo and MVP readiness

**NFR-42** The system shall support a coherent end-to-end MVP scenario in which artifacts are ingested, memory is reconstructed, and a real question is answered with evidence.

**NFR-43** The system shall support a coherent end-to-end MVP scenario in which a newly submitted conflicting artifact can trigger contradiction or assumption-drift detection and a grounded next-action recommendation.

**NFR-44** The system should be demonstrable without requiring hidden manual explanation for every step.

**NFR-45** The system should make the “why” behind its outputs clear enough for a jury, reviewer, or early customer to trust the workflow.

**NFR-46** The system should feel like a real product rather than a collection of disconnected prototype pages.
