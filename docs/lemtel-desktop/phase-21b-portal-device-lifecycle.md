# Lemtel Phase 21B — Desktop portal device lifecycle

## Authority
The portal stays the authority for Desktop access, devices and configuration. Base commit: `128b45ebb`.

## Flow
```text
Authenticated Desktop session
  -> useLemtelDesktopClientConfig (register once, then validated manifest)
  -> existing Desktop telephony credential flow (unchanged)
  -> single existing JsSIP owner (SipKeepAlive)
```
- `register` sends `platform: "desktop"` and the opaque `installationRef` (key `lemtel.desktop.installation_ref.v1`); later refreshes send `manifest` with the opaque `deviceRef`.
- Only the published authenticated function `lemtel-client-config` is called by the lifecycle code.
- Telephony credentials still come only from the existing Desktop flow, and only after the manifest is `allowed`.

## Security decisions
- Manifest `lemtel_client_config_manifest_v1` validated strictly: exact keys, no extra key, every enum, opaque references, `dev_[0-9a-f]{32}`, UTC dates ending in `Z`, exactly four capabilities.
- Telephony allowed only if: `desktopEnabled === true`, account `active`, device `approved` with action `none`, four privacy scopes `own_extension_only`, `direct_current` routing and fallback, `edgeFeatureGate === false`, revocation behavior `stop_sip_and_clear_local_session`, manifest not expired.
- No legacy mode: no valid session or an expired manifest gives `unavailable`; telephony never starts.
- The cache (`lemtel.desktop.client_config.v1`) holds only the validated manifest and its check time. It may be reused only after a transient failure and only while still valid and allowed.
- Foreground refresh only on `focus`/`visibilitychange`, never during a ringing/active/held call, at most every 900 s. No interval, worker or background job in the lifecycle code.

## Data explicitly refused
Token/JWT, SIP identifier, password, WSS URL, host, number, CDR, recording, voicemail, audio, contact or call data are never stored in the manifest/cache and never logged. The `installationRef` is never displayed, logged or deleted.

## Blocking conditions
- `pending_block` on a non-allowed policy or a public block code (`device_revoked`, `platform_access_disabled`, `app_access_disabled`, `no_softphone_account`).
- While pending: new call, retry, restart, auto-heal/re-registration and periodic CDR sync are refused (`allowNewActions = false`); an existing call stays answerable, mutable, holdable and can be hung up manually. No automatic hangup.
- Once idle: `sipProvider.stop()` exactly once (guarded by a local ref so `SIGNED_OUT` does not stop twice), manifest cache cleared, `signOut({ scope: "local" })`, local Electron credentials, `lemtel-desktop-auth` and `lemtel.sip_password` removed, in-memory API token cleared, screen "Accès Desktop indisponible" with "Revenir à la connexion" (returns to the setup wizard, no reload, no automatic call).
- The existing CDR sync and background sync are mounted only in the allowed subtree.

## Tests
- `apps/ava-softphone-desktop/src/lib/lemtelDesktopClientConfig.test.ts`, `src/hooks/useLemtelDesktopClientConfig.test.tsx`, `src/test/lemtelDesktopPortalLifecyclePhase21.test.ts` (all calls mocked).
- Root regression `src/test/lemtelDesktopPortalLifecyclePhase21.test.ts`: guards before/after, nine-file scope from `128b45ebb..HEAD`, temporary Git repository proof, static policy checks.

## Non-goals
No migration, Supabase function, portal, PBX, FusionPBX, Edge, Electron main/preload, package or lockfile change. No change to the JsSIP provider, credential URLs or SDP rules. Verto and PJSIP stay forbidden. No automatic speaker. Desktop build and physical Mac validation are a separate step, without publication.

## Phase 21B.1 — closing async races during revocation
Sub-phase base: `313f86c1f`. Scope: `useSoftphone.ts`, the Desktop lib test, the root regression test and this document.
- Every existing async action that could create new telephony re-checks authorization right before its effect (`cancelled || !allowRef.current` after `setSession`, `getSession`, the credential fetch, and before `setConfig`/`sipProvider.init`).
- A revocation during a credential fetch or an auto-heal cannot trigger an init or re-registration after the block (auto-heal re-checks after `getSession` and after the response, before `setRetryTick`).
- Blind transfer, attended consult and complete transfer are refused during `pending_block`.
- Cancelling a consultation and existing-call controls (answer, hangup, mute, unmute, hold, unhold, DTMF) remain manual and available.
- No backend, PBX, FusionPBX, JsSIP provider or Planiprêt change.
