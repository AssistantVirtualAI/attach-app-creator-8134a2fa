# Lemtel — Phase 18A: Verto removed from the active mobile runtime

**Baseline:** `85712b3d0` (branch `Planipret`). Source and tests only; no build published.

## Runtime changes (exactly two)
1. `apps/ava-softphone-mobile/src/hooks/useSoftphone.ts` — removed the unused Verto hook import; reworded the Android comment. Dispatch outcome unchanged.
2. `apps/ava-softphone-mobile/src/MobileApp.tsx` — removed the Android ref and effect that called `fusionpbx-proxy` with the Verto routing-repair action after credentials were ready.

## Intentionally untouched
The dormant Verto hook/provider files and the Android native legacy code are unchanged. They are no longer imported by the active dispatch; removal is deferred to an audited phase so calling, notifications and the foreground service are not put at risk.

## Selected providers (proof)
- `NATIVE_SIP_ENABLED === true` → `useSoftphoneNative(config)` (iOS PJSIP).
- Android, native disabled → `useSoftphoneJsSip(config, opts)` (SIP/WSS :7443).
- Web/dev, native disabled → `useSoftphoneJsSip(config, opts)`.
Covered by `useSoftphone.runtime.test.tsx` (Verto modules mocked to throw if imported) and `src/test/lemtelMobileVertoRuntimePhase18.test.ts`.

## Preserved
Android foreground service, native notifications, microphone/contacts permissions, WakeLock/WifiLock, locked-screen incoming calls, manual-only speaker, portal login and `softphone-credentials` delivery, `softphone-sync-password` recovery, the current direct SIP/WSS route, and own-extension-only CDR/recording/voicemail/transcript access. No Planiprêt path changed.

## Validation commands
```bash
node scripts/verify-lemtel-planipret-isolation.mjs
npx vitest run apps/ava-softphone-mobile/src/hooks/useSoftphone.runtime.test.tsx
npx vitest run src/test/lemtelMobileVertoRuntimePhase18.test.ts
npx vitest run apps/ava-softphone-mobile/src/lib/creds.test.ts apps/ava-softphone-mobile/src/hooks/useSoftphone.test.tsx apps/ava-softphone-mobile/src/hooks/useSoftphoneFailures.test.tsx apps/ava-softphone-mobile/src/hooks/useSoftphone.runtime.test.tsx src/test/lemtelMobileVertoRuntimePhase18.test.ts
npm --prefix apps/ava-softphone-mobile run build
rg -n -i 'useSoftphoneVerto|repair-verto-extension-routing|vertoProvider|verto\.answer|verto\.bye' apps/ava-softphone-mobile/src/MobileApp.tsx apps/ava-softphone-mobile/src/hooks/useSoftphone.ts
git diff --check
git status --short
```
No PBX call, incoming/outgoing/background call, physical-device test, App Store or Play Store build occurred.

## Next phase
**Phase 18B — audited removal of dormant Verto source and native Verto-only transport**, only after Phase 18A is independently reviewed and accepted.
