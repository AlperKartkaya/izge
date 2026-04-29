# SECURITY_GOVERNANCE.md
## Security, Governance, and Trust Design

## Core principle
Izge is about internal organizational memory.
Trust is part of the product, not an add-on.

## Minimum security and governance requirements
- authenticated users,
- role-based access,
- artifact access control,
- evidence-aware permission handling,
- query and signal outputs that respect permissions,
- audit logging,
- local-first data handling by default,
- company-controlled primary inference in the MVP.

## Roles
- Admin
- Member

## Artifact access rule
Graph traversal and evidence references must remain permission-aware.
Restricted artifacts must not leak through summaries, signal explanations, or query results.

## Local-first rule
For MVP:
- artifacts remain within company/customer-controlled infrastructure,
- the main reasoning layer is company/customer-controlled,
- external hosted AI is not the primary reasoning dependency.

Interpretation:
- `app.izge.dev` is acceptable for jury/pilot use only when backed by Izge-controlled EC2 storage and EC2-local/private inference.
- Customer production should default to a customer-controlled/self-hosted deployment with customer-controlled storage and inference.
- Managed single-tenant deployments are acceptable as pilot/commercial bridges.
- Generic multi-tenant SaaS and employee-local edge inference are not MVP trust assumptions.

## Intake governance
Members may contribute artifacts such as logs, reports, notes, and presentations.
The system should support clear intake and processing states, and may support optional review states without making review mandatory for all MVP flows.

## Audit logging
Log at minimum:
- sign-ins,
- uploads,
- pasted text submissions,
- ingestion runs,
- extraction results,
- proactive signal generation,
- query submissions,
- graph update events,
- permission changes.

## Final governance rule
If the product produces impressive answers but users cannot tell what evidence was used or whether restricted information leaked, governance has failed.
