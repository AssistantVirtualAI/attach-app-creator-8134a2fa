# Commissions: an exact reading of every row coming from Maestro, checked by Claude

## Goal
Every number on screen (total, files, volume, average, categories, monthly tables, broker table) comes from the Maestro endpoint rows and is traced back to them. No number is "assumed": if a row is set aside, the screen says how many and why.

## 1. Full reading of each row (paid and pending)
- Every received field is read and checked: type, amount, loan, date, contract, broker, primary broker, product, institution, status.
- Each row is put into one category: counted, set aside (no date, loan at 0, amount not numeric, duplicate, outside the period, another broker's file), or in error.
- Duplicates are detected with the full key (commission, contract, product, type, amount), not just the contract.
- Pagination is checked: number of rows announced by Maestro against rows received. A missing page is reported, never hidden.

## 2. One single rule for files and volume, the same everywhere
- Files: base rows only, each contract counted once, broker's own files kept separate from the team's.
- Volume: positive base loans, one entry per contract + product, team kept separate.
- Commissions: all categories, matched to the cent against Maestro's official totals.
- The same rule is used for the cards, the monthly tables, the "Commissions by broker" table, AVA and the mobile app.

## 3. Claude analyses each reading in real time
- On each read from Maestro, Claude receives the full profile: row counts by category, rows set aside and why, duplicates, pagination, totals in cents, and the comparison with the previous saved copy (unusual change from one day to the next).
- Claude flags inconsistencies (e.g. a sudden drop in files, a contract with two different loans, a type it doesn't recognise) and explains them in plain words.
- Code stays the authority on the arithmetic: Claude never changes an amount. A mandatory check that fails blocks the display and the last validated copy is kept.
- Every analysis is kept for the audit (per broker, per source, per time).

## 4. Display
- Under each card, a "Data quality" line: rows received, counted, set aside (with the reason), Maestro check status, Claude analysis.
- A "Detail" button lists the rows that were set aside, so they can be checked against Maestro.
- Fix the "Commissions by broker" table (pending) so it uses the same rule.

## 5. Check against Maestro
- Sandra: compare line by line with your figure (about 151 contracts / 45 821 568,18 $) and name the exact source of the gap (e.g. undated files, loan at 0).
- All connected brokers: paid and pending, own and team, report to the cent with the remaining gaps explained.
- Portal and mobile app read the same server source: corrected at the same time, no native changes.

## Decision to confirm
- Pending files with no date yet (6 for Sandra): count them in the files or show them separately? By default: shown separately, not counted.

## Technical details
- `_shared/commission-reports.ts`: `classifyRow()` (reasons: undated, zero_loan, non_numeric, duplicate, out_of_window, other_broker), `fileVolumeRule()` shared by paid and pending, `readProfile` (counts by reason, pagination announced against received).
- `planipret-commission-reports`: summaries computed from `fileVolumeRule`; response includes `data_quality` and `excluded_rows` (admin, or a broker for their own files); `by_agent` and team splits use the same rule. Remove the old `deposit_count` that was overwritten.
- `_shared/commission-validation.ts`: the Claude payload gets `data_quality`, the duplicate/conflicting-loan profile and the delta against the previous snapshot (`planipret_commission_snapshots`); store each analysis in a `planipret_commission_ai_audit` table (RLS admin).
- Front-end (src and apps/planipret-mobile/src, kept identical): `DataQualityLine` component under the cards + "Detail" drawer.
- Snapshots cleared after deployment; regression tests (rules, duplicates, pagination, Claude advisory only).
