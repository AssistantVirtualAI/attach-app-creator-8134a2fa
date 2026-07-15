## What we're fixing

1. **SMS send fails with edge function error** from Directory → contact → SMS composer.
2. **Floating dial-pad FAB overlaps the Send / composer** in Messages, Team chat, and AVA chat (see screenshot).
3. **Endpoint sanity across all pages** for the phone system (NS-API) and Microsoft 365 — surface the real status instead of silent failures.

---

## 1. Fix the SMS send error

Root cause is that `pp-ns-sms` proxies `POST /messagesessions` on NS, but the composer never verifies whether the broker actually has an assigned SMS number, and when NS returns a 4xx (no SMS number, invalid destination, thread not found) the composer only shows a generic "Échec envoi SMS" without the real reason. Logs confirm the POST leaves the function but no downstream success path is logged.

Changes:

- **`SmsComposerSheet`** (in `apps/planipret-mobile/src/pages/planipret/mobile/MContacts.tsx`):
  - Before sending, call `pp-ns-sms?action=sms-numbers` once (cached) to confirm the user has at least one SMS number. If none, show a clear inline banner: *"Aucun numéro SMS assigné à votre extension — contactez l'admin"* and disable Send.
  - Normalize `to` to E.164 (Canadian default: strip non-digits, add `+1` if 10 digits) before invoking.
  - When the invoke returns a non-2xx or `{ error, status, body }`, surface `body`/`error` text in the inline error banner instead of the raw generic message.
  - Retry once automatically on transient 502 from NS.
- **`pp-ns-sms/index.ts`**:
  - Log the NS response body on failure with `console.error` (currently only returns 502).
  - When creating a new session, pass `from` = first assigned SMS number so NS doesn't reject with "no source".
  - Return `{ error, ns_status, ns_body }` consistently so the client can display it.

## 2. Hide the dial FAB when a text composer is active

The right-side blue FAB in `PlanipretMobile.tsx` (lines ~796-812) is absolutely positioned above the tab bar and covers the message input's Send button on the Messages and AVA screens.

Changes in `apps/planipret-mobile/src/pages/planipret/PlanipretMobile.tsx`:

- Hide the FAB entirely on routes `/mplanipret/messages` and `/mplanipret/ava` (read via `useLocation`). Users can still open the dialer from the Calls tab or from any contact row.
- On other pages, additionally hide it while any `input`/`textarea` inside the outlet has focus (listen for `focusin`/`focusout` at the outlet container). This covers the "chat teams" sub-tab and any modal composer.
- Keep the red hang-up state visible in all cases (an active call must always be reachable).

## 3. Endpoints sanity across pages

Instead of touching every page blindly, add a **Diagnostics** panel and fix the small integrations that show up as broken from it.

- **New page `MDiagnostics.tsx`** (route `/mplanipret/diagnostics`, linked from `MMore`) that runs, in parallel, one probe per surface and shows OK / degraded / error with the underlying error text:
  - `pp-ns-auth` → identity + extension link
  - `pp-ns-sms?action=sms-numbers` → SMS reachable + assigned numbers
  - `pp-ns-calls?action=recent&limit=1` → calls history reachable
  - `pp-ns-voicemail?action=list&limit=1` → voicemail reachable
  - `pp-ns-contacts?action=directory&limit=1` → directory reachable
  - `ms365-status` → Microsoft connection status
  - `ms365-actions?action=list_folders` (light call) → Mail scope OK
  - `ms365-teams-list` → Teams scope OK
  - `pp-calendar-sync?action=probe` → Calendar scope OK
  - `maestro-client-lookup?ping=1` → Maestro reachable
- Each row exposes a "Copy details" button (function name, HTTP status, error body) so we get actionable reports next time something breaks.
- Fix the small connection gaps the diagnostics uncovers:
  - `AppointmentSheet` currently calls `maestro-appointment` with `type: "phone"`. Switch to the same shape used by `useAppointments` (`book-appointment` with `action: "create"`) when the profile has no Maestro client, so RDVs still land in `appointments` table + calendar.
  - `EmailComposerSheet` already reconnects on `ms365_not_connected`; extend the same handling to Teams (call `ms365-teams-list`; if 401, kick off `connectMs365` before the message send).
  - Add a shared helper `callEdge(fn, body)` that always throws a rich error `{ status, body, message }` so all pages report the same way; use it in the sheets and diagnostics.

## Non-goals

- No changes to `/mplanipret` routes or `MplanipretGuard` (locked constraint).
- No changes to the main-app `src/pages/planipret/mobile/MContacts.tsx` (the mobile build uses `apps/planipret-mobile`).
- No rework of the Dialer itself — just its FAB visibility rule.

## Files touched

- `apps/planipret-mobile/src/pages/planipret/mobile/MContacts.tsx` — composer improvements, error surfacing, SMS-number preflight.
- `apps/planipret-mobile/src/pages/planipret/PlanipretMobile.tsx` — FAB visibility rule.
- `apps/planipret-mobile/src/pages/planipret/mobile/MMore.tsx` — link to Diagnostics.
- `apps/planipret-mobile/src/pages/planipret/mobile/MDiagnostics.tsx` — **new**.
- `apps/planipret-mobile/src/App.tsx` — nested route `diagnostics` inside `/mplanipret`.
- `apps/planipret-mobile/src/lib/callEdge.ts` — **new** shared invoke helper.
- `supabase/functions/pp-ns-sms/index.ts` — log NS body on failure, include SMS source, structured error payload.
