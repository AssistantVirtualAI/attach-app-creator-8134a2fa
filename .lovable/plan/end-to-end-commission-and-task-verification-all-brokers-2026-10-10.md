# End-to-end commission and task verification (all brokers)

## Goal
Prove that paid and pending commissions come from separate Maestro sources, are reconciled for each broker, are checked by Claude, and reach both the portal and the mobile app. Confirm that every broker, Sandra included, sees only their own real commissions and tasks.

## Steps
1. **Broker inventory**: list every linked broker (Maestro broker id, telecom id, connection status). Flag any broker missing a link.
2. **Per-broker test, signed in as each broker** (read-only):
   - Paid: summary and deposits. Record totals, deposit count, funded units and volume.
   - Pending: record the total and the row count after removing duplicates.
   - Confirm the paid and pending numbers are different, and that each comes from its own endpoint.
   - Confirm a failure shows an error, never a 0.
3. **Reconciliation per broker**: re-add every raw row (in cents) and compare it to the totals shown. Note any gap, like Sandra's 501.86 $ on paid. Gaps are reported, never forced to match.
4. **Claude validation check**: confirm Claude receives each broker's incoming numbers, records a verdict, and that only the server-side cent check decides whether numbers are published. Claude stays advisory. Add a test that a Claude failure or disagreement does not hide or change the figures.
5. **Dispatch check**: the portal and mobile screens (paid and pending panels) read the same validated responses. Verify both views in a browser for Sandra plus a sample of brokers.
6. **Tasks**: for each broker, call the task list and confirm the tasks returned belong to that broker. Fix any broker that gets 0 tasks or an error.
7. **Fixes**: fix any broken connection, scoping leak or sum mismatch at the server level so the portal and the app both get the fix. Add regression tests and deploy the full set together, never a partial release.
8. **Report**: a table per broker with paid, pending, gap, Claude verdict and task count, plus any open gaps.

## Technical details
- Functions: `planipret-commission-reports` (summary/pending/deposits), `planipret-task-api`, `_shared/commission-validation.ts`.
- Sessions are created per broker with `lovable auth-session --user <uuid>`, and edge functions are called with that user's token. No secrets are logged.
- The mobile app only picks up fixes after the next app update.
- Still open: whether to split pending volume into own vs team. Until you decide, it is shown as it is today.
