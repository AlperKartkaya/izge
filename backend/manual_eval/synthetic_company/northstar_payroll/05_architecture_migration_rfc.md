# Northstar Payroll ledger migration RFC

Date: 2026-04-04

Engineering assessed a migration from the legacy payroll ledger service to the consolidated LedgerBridge API.

## Decision
We chose a phased LedgerBridge migration for Northstar Payroll instead of a same-week cutover during enterprise onboarding launch.

## Constraints
The migration cannot drop historical payroll ledger evidence and must keep source artifact references stable for audit review.
The platform migration depends on replayable stage packets and a worker queue before any external worker can process reconciliation tasks.

## Commitments
Platform owner Selin will document the LedgerBridge rollback plan by 2026-04-12.
