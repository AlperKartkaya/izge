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
- artifacts remain within company-controlled infrastructure,
- the main reasoning layer is company-controlled,
- external hosted AI is not the primary reasoning dependency.

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
