## Goals
1. Eliminate the visible loading delay when switching between mobile tabs.
2. Make Directory contact actions (Call, SMS, Email) act **inside** the app instead of opening iOS Phone/Messages/Mail.

## 1. Faster page loads

Chunks are lazy but only fetched on first visit → each new tab shows a spinner.

- Warm every mobile tab chunk right after the shell mounts (idle-time prefetch) via `routePrefetch.ts` — pre-import `MHome`, `MCalls`, `MMessages`, `MVoicemail`, `MContacts`, `MPipeline`, `MStats`, `MMore`, `MAvaChat`, `MAvaNotifications` in the background.
- Also prefetch on tab-bar hover / touchstart (already scaffolded — wire it up for all bottom-tab buttons).
- Replace the blank `Suspense` fallback with an instant skeleton matching the tab layout, so perceived load is 0.
- Cache the per-tab first-paint data (contacts, messages, calls) in memory so returning to a tab is instant; refresh in background.

## 2. In-app actions from ContactDetailSheet (Directory)

Current: SMS goes through in-app composer ✅, but **Call** falls back to native dialer and **Email** uses `mailto:` (opens iOS Mail).

- **Call** → route through the app's phone system: open `MCalls` with the number preloaded and trigger the existing dial flow (WebRTC / edge function used elsewhere in `MCalls`). Close the sheet, navigate to `/mobile/calls?dial=<e164>`, auto-start the call.
- **SMS** → keep the in-app composer sheet (already working); ensure it's launched from Directory too and pre-fills recipient + focuses input.
- **Email** → replace `window.location.href = mailto:` with an in-app **Compose Email sheet** that sends via the Microsoft 365 integration (`ms365Connect` → Graph `sendMail`). If MS365 not connected, prompt to connect (reuse existing `ms365Connect.ts` flow), never fall back to `mailto:`.

## 3. Consistency

- Audit remaining `tel:`, `sms:`, `mailto:` usages in `apps/planipret-mobile/src` and replace with in-app equivalents (except the support link on the locked-access screen).

## Files to touch
- `apps/planipret-mobile/src/App.tsx` — idle prefetch of all tab chunks, skeleton fallback.
- `apps/planipret-mobile/src/lib/routePrefetch.ts` — expose `prefetchAllMobileTabs()`.
- `apps/planipret-mobile/src/pages/planipret/PlanipretMobile.tsx` — hover/touch prefetch on bottom tabs, skeleton.
- `apps/planipret-mobile/src/pages/planipret/mobile/MContacts.tsx` — Call routes to `MCalls` dialer; Email opens new in-app compose sheet.
- New `apps/planipret-mobile/src/components/planipret/mobile/EmailComposerSheet.tsx` — MS365 Graph sendMail.
- `apps/planipret-mobile/src/pages/planipret/mobile/MCalls.tsx` — accept `?dial=` query param and auto-start call.
