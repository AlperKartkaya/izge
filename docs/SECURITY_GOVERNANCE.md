# SECURITY_GOVERNANCE.md
## Security, Governance, and Trust Design

## Core principle
This product is about internal institutional memory.
Trust is part of the product, not an add-on.

## Minimum security requirements
- authenticated users,
- workspace isolation,
- role-based access,
- artifact access control,
- query access control,
- audit logging,
- local-first data handling by default.

## Roles
- Admin
- Editor / Analyst
- Viewer

## Artifact access rule
Graph traversal and evidence references must remain permission-aware.
Hidden artifacts must not leak through summaries.

## Audit logging
Log:
- uploads,
- ingestion runs,
- extraction results,
- query submissions,
- graph update events,
- contradiction detection runs,
- permission changes.

## Final governance rule
If a feature weakens trust, it weakens the product.
