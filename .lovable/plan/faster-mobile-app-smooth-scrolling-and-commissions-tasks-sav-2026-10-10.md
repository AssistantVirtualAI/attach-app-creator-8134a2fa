# Faster mobile app: smooth scrolling and commissions/tasks saved on the server

## 1. Scrolling on every page in "Plus"
- Check every page you can open from "Plus": Commissions (Pending/Paid), Tasks, Pipeline, Maestro, Voicemail, Email, Settings, Connections, Feedback.
- Fix the problems that stop scrolling: locked screen, pages cut off by the top or bottom bar, lists stuck inside a block, pop-up windows that block the page.
- Scroll back to the top when a page opens, and keep your scroll position when you come back to it.

## 2. Commissions saved on the server, refreshed every hour
- The server reads Maestro once an hour for each connected broker, for both pending and paid. It keeps the results per broker and per period.
- The app and the portal read this saved copy, so the page shows up right away instead of waiting for Maestro.
- If Maestro fails, the last good copy stays on screen. The page shows the update time and never shows $0.
- A "Refresh" button forces an update on demand, limited to one per few minutes.
- Totals are still checked to the cent before they are saved, and each broker still sees only their own data or their team's.

## 3. Tasks saved on the server too
- Tasks are also refreshed in the background (the existing task sync). The page opens with the saved copy, then updates quietly.
- Creating or completing a task still goes straight to Maestro, then the saved copy is updated.

## 4. Speed of pages connected to Maestro
- On the phone, keep the last copy of each page so it shows up instantly, then update it.
- Fewer requests when the Home screen opens: group the counters and remove duplicates.
- Measure load time before and after on Commissions, Tasks, Calls, Messages, Contacts and Maestro.

## 5. Testing
- Automated run on a phone-sized screen: open each "Plus" page, scroll to the bottom and back up, and check there are no errors.
- Check, with Sandra's account, that the saved copy shows the same figures as Maestro.
- Same changes in the portal and the mobile app. Nothing native on iOS/Android. No partial release: the app part goes into the next complete update.

## Technical details
- Table `planipret_commission_snapshots` (broker_id, kind paid|pending, period_key, payload jsonb, validation, fetched_at), RLS = owner, team lead or admin through the existing helpers.
- `planipret-commission-reports` reads the snapshot first if it is under 60 min old; otherwise it calls Maestro, validates and writes. Parameter `force` limited to once every 5 min per broker.
- Hourly job (pg_cron, 24 runs/day) calling a bounded worker that runs through brokers in batches, with a lock and a per-broker resume point.
- Tasks: reuse the existing projection / `pp-maestro-tasks-sweeper`; the client shows the projection right away.
- Scrolling: one shared scroll container in `#pp-mobile-frame`, `min-h-0` / `overflow-y-auto` on the pages, remove the leftover `body.style.overflow` locks, bottom padding of `env(safe-area-inset-bottom)` plus the bar height.
