## 1. Change password (root cause confirmed)

`MMore.tsx` row "Change password" calls `navigate("/reset-password")`, but the mobile router (`apps/planipret-mobile/src/App.tsx`) has no such route — the catch-all `<Route path="*" element={<Navigate to="/mplanipret" replace />} />` sends the user straight back to Home. Same for the Privacy row, which navigates to `/planipret/privacy` (also not registered in the mobile router).

Fix:
- Add a new in-app screen `MChangePassword.tsx` (mobile-styled, bilingual FR/EN, safe-area header) that asks for the new password + confirmation and calls `supabase.auth.updateUser({ password })`, with validation (min length, match), error handling and a success toast then back to Settings.
- Register `/mplanipret/change-password` in the mobile router and point the settings row at it.
- Register a mobile privacy route (or reuse the existing privacy screen) so the Privacy row no longer bounces to Home.

## 2. Audit of every settings row

Verify each row in `MMore.tsx` resolves to a real registered route or opens its sheet, and fix any that fall through to the catch-all redirect:
- Navigation rows: AVA chat, notifications, pipeline, performance, extension sync, voicemails (`/mplanipret/calls?tab=voicemails` — confirm `MCalls` actually reads the `tab` query param; it currently uses internal state, so wire it to `useSearchParams`), connections, Maestro sync, diagnostics, MS365 diagnostics, SIP debug, privacy, change password.
- Sheet rows: profile edit, language, DND, customize AVA, help, ringtones, delete account.
- Action rows: NS reconnect, MS365 connect/disconnect, logout.

Each broken target gets either a route registration or a corrected path. A small route-existence test (`routes.test.ts`) will assert every path referenced in `MMore.tsx` matches a declared route, so this class of bug can't come back.

## 3. AVA Brief — one generation per period per 24h

Today `MHome` calls `loadBrief(false)` in a `useEffect` on every mount and on every period change, so navigating back to Home re-invokes `pp-ava-brief` and burns tokens.

Fix:
- Persist the brief in `localStorage` (not sessionStorage) keyed by `user + period` with a `generatedAt` timestamp, via new helpers in `mhomeCache.ts` (`loadBriefCache` / `saveBriefCache`).
- On mount/period change: if a cached brief exists and is < 24h old, render it immediately and make **no** edge-function call. Only fetch when the cache is missing, older than 24h, or `force === true` (pull-to-refresh / explicit refresh button).
- Keep separate cache entries for daily / weekly / monthly so each is generated at most once per 24h.
- Show a subtle "Generated at HH:MM" line plus the existing manual refresh so the user can always force a regeneration.
- Guard against concurrent calls with an in-flight ref so double mounts (StrictMode / prefetch) can't fire twice.

### Technical notes
Changes must be mirrored in both copies of the app tree (`src/pages/planipret/mobile/**` and `apps/planipret-mobile/src/**`), which are kept in sync. No backend/schema changes required; `pp-ava-brief` stays as-is.
