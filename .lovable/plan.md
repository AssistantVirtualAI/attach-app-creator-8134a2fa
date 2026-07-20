
## Goal

Every Planiprêt broker must be able to connect their own Maestro account from the mobile app (no admin portal required), and AVA (chatbot + voice agent) must call Maestro using that per-broker OAuth token instead of a shared API key.

## 1. Mobile — "Connect Maestro" in Settings

Files: `apps/planipret-mobile/src/pages/planipret/mobile/MMore.tsx`, new `apps/planipret-mobile/src/components/planipret/mobile/MaestroConnectCard.tsx`, `src/App.tsx` deep-link handler (already exists).

- Add a **Maestro** section in `MMore` (Settings/Plus screen) showing the same 3 states as the admin page:
  - `disconnected` → button **"Connecter Maestro / Connect Maestro"**
  - `pending` → spinner + "Ouverture de Maestro…"
  - `connected` → green check, broker email/id, **Reconnecter** + **Déconnecter** buttons
  - `error` → red banner with detailed message + **Réessayer**
- Card calls the existing edge functions — no new backend:
  - `maestro-oauth-status` (GET) to read state
  - `maestro-oauth-start` with `{ platform: "mobile", redirect_uri: "planipret://auth/maestro/callback" }` → returns `authorize_url`
  - Open URL via `@capacitor/browser` `Browser.open({ url })` (in-app browser, not system) so the redirect back into `planipret://` reliably wakes the app.
- The existing `appUrlOpen` listener in `App.tsx` already routes `planipret://auth/maestro/callback` to the in-app `/auth/maestro/callback` page → `maestro-oauth-callback` exchanges the code with PKCE (client_id=3). No changes required there.
- Add a **Disconnect** action: new edge function `maestro-oauth-disconnect` that clears `maestro_access_token / refresh_token / expires_at / maestro_oauth_client` on `planipret_profiles` for `auth.uid()`.
- i18n: add keys under `mplanipret.settings.maestro.*` in `apps/planipret-mobile/src/lib/i18n/mplanipret.ts` (FR + EN).

## 2. AVA chatbot + voice agent — use per-broker Maestro OAuth token

Files: `supabase/functions/ava-tool-executor/index.ts`, `supabase/functions/_shared/maestro-oauth.ts` (already exists with `getUserMaestroAccessToken`), and any Maestro-calling edge function used by the ElevenLabs voice agent (`maestro-task`, `maestro-appointment`, `maestro-ai-analysis`, `maestro-telecom`).

- Replace the current `maestroFetch` helper in `ava-tool-executor` (which reads legacy `maestro_broker_token` / falls back to `MAESTRO_API_KEY`) with a call to `getUserMaestroAccessToken(admin, ctx.profile.user_id)` from `_shared/maestro-oauth.ts`. Auto-refresh already handled there.
- Same substitution inside `maestro-task`, `maestro-appointment`, `maestro-ai-analysis` so the voice-agent tool calls hit Maestro as the authenticated broker.
- Verify `maestro-telecom` (already migrated to `getUserMaestroAccessToken`) — no change.
- When the token is missing, return a structured tool error `{ error: "maestro_not_connected", action: "prompt_user_to_connect" }` so AVA replies in-conversation with: *"Connectez d'abord votre compte Maestro dans Réglages → Maestro."* Add that phrasing to the AVA system prompt / tool-error mapping.
- Voice agent (ElevenLabs): the agent already calls the same edge functions via `ava-tool-executor` → picks up the change automatically. No ElevenLabs config change required.

## 3. Admin page — reuse the shared card

Refactor `PAMaestroStatus` / the section inside `PAMaestroSync` to import the same `MaestroConnectCard` (web variant using `window.location`), so admin + mobile stay in sync.

## 4. QA

- Broker logs into mobile → Settings → Connecter Maestro → in-app browser → Maestro login → returns via `planipret://` → status becomes `connected`.
- Ask AVA chat "Combien de RDV cette semaine ?" → tool call succeeds using the broker's token.
- ElevenLabs voice agent triggers `maestro-task` create → succeeds with the broker's token.
- Disconnect button clears tokens and AVA falls back to the "please connect Maestro" message.

## Out of scope

- No changes to Maestro OAuth server config (already registered by Scott, secrets already set).
- No changes to the existing web callback route or PKCE logic.
- No new tables.

## Technical notes

- Use `@capacitor/browser` (already a Capacitor dep — verify in `apps/planipret-mobile/package.json`; if missing, add it in the build phase).
- Custom scheme `planipret://` already declared in `native-config/android-AndroidManifest.snippet.xml` and `ios-Info.plist.snippet.xml`.
- `planipret_profiles` already has the OAuth columns (`maestro_access_token`, `maestro_refresh_token`, `maestro_token_expires_at`, `maestro_oauth_client`) — migration applied earlier.
