# Monthly billing report by email + call queue / IVR billing

## What you will get
- On the **1st of every month**, an email goes to mhassoun@assistantvirtualai.com and amassaro@assistantvirtualai.com with last month's billing summary.
- The email has a clear table:
  - **Users per plan** (Widget only, Widget + app without AVA, Full kit): last month's count, new users, total count, cost, price and margin.
  - Example: 80 Full kit users × 50 $ cost / 99,95 $ price, plus 1 new Widget + app user × 30 $ / 79 $.
  - **Call queues and IVRs** taken from NetSapiens: 11,99 $/month each, plus a one-time 100 $ activation fee for each one added that month.
  - Totals: monthly cost, monthly price, margin, activation fees.
- **Admin portal (Overview)**: a new "Call queues & IVR" section lists each one with its monthly amount, activation fee and date added, next to the existing plan breakdown.

## How it works
- Plans are still set by the existing app/AVA Chat/AVA Voice switches.
- Each month a snapshot is saved (users per plan, queues, IVRs). The email compares the new month with the previous one to show what was added.
- The first email has no previous month, so everything shows as "existing".
- Call queues and IVRs are read from NetSapiens (read-only, nothing changed there). The first one we see for each queue/IVR counts as its "added" date.

## Before sending
- App emails need your own domain set up for sending. If it isn't set up yet, I'll show you the setup button.
- I'll send one test email to you first, before the monthly schedule starts.

## Technical details
- Migration: `planipret_billing_items` (NetSapiens queue/IVR id, type, name, first_seen_at, removed_at, monthly 11.99, activation 100) and `planipret_billing_snapshots` (month, per-plan counts, items, totals JSON). RLS: planipret admins read; service_role writes.
- Edge function `pp-billing-monthly`: read-only NetSapiens list of call queues and auto-attendants, upserts items, computes plan counts with the same logic as the Overview, saves snapshot, sends the `planipret-monthly-billing` app email template to both addresses (one send per recipient, idempotency key `billing-{month}-{email}`).
- Managed HTTP schedule `0 11 1 * *` (1st of month, ~07:00 Toronto), runs once a month.
- Portal: Overview section reads items + latest snapshot; same plan constants as today.
- No change to telephony routing, SMS, Lemtel, iOS or Android.
