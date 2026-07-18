# Switch Android to FreeSWITCH Verto (port 8082)

## Goal
On Android, replace JsSIP/WSS + TURN with FreeSWITCH Verto over WSS on `pbxnode.lemtel.tel:8082`. iOS keeps using the native PJSIP plugin. No changes to iOS native code.

## Why
- Verto uses FreeSWITCH's server-side media bridge, so no TURN is needed. This bypasses the Bell Canada TURN DNS block that currently causes `ice=new` timeouts on Android.
- Port 8082 WSS is already open on `pbxnode.lemtel.tel`.

## Scope
Only `apps/ava-softphone-mobile`. No changes to:
- `CapacitorSip.swift`, `CallKitManager.swift`, `Main.storyboard`, `project.pbxproj`
- iOS runtime path
- Planiprêt mobile app

## Implementation

### 1. Load the Verto client
The `jQuery.verto` client (bundled with FreeSWITCH at `/verto/js/verto.js`) is the canonical Verto library. `@fusionpbx/verto` on npm does not exist. Two options:

- **A. Script tag in `apps/ava-softphone-mobile/index.html`** loading jQuery from jsDelivr and `verto.js` from the PBX. Simple, matches the snippet you gave.
- **B. Vendor `jquery` + a local copy of `verto.js`/`jquery.jsonrpcclient.js`** into `src/vendor/verto/` and import them from `vertoProvider.ts`. Cleaner for offline/Capacitor, avoids runtime network dependency on the PBX for the JS file itself.

Recommended: **B** for a Capacitor native app (the WebView shouldn't need to fetch JS from the PBX at boot). I'll vendor the files.

### 2. New provider: `src/lib/sip/vertoProvider.ts`
Wraps `jQuery.verto` with:
- `initVerto(config)` — connect + register, resolves on `onWSLogin`, rejects on `onWSClose` before login.
- `vertoCall(number, callerName)` — outbound call, returns dialog handle.
- `vertoHangup(dialogId?)` — hang up a specific dialog or all.
- `vertoAnswer(dialogId)`, `vertoSendDTMF(dialogId, digit)`, `vertoMute/Unmute(dialogId)`, `vertoHold/Unhold(dialogId)`.
- Emits events (`registered`, `unregistered`, `incoming`, `progress`, `answered`, `hangup`, `mediaError`) so the React hook can subscribe.
- `iceServers: false` (Verto handles media server-side).

### 3. New hook: `src/hooks/useSoftphoneVerto.ts`
Implements the same `UseSoftphoneReturn` surface currently exposed by `useSoftphoneJsSip`/`useSoftphoneNative`:
`status, registered, calls, activeCallId, call, hangup, answer, mute, unmute, hold, unhold, sendDTMF, setStatus, reconnect, lastPersistedError, sipLog, clearSipLog, clearSipState, retryAttempt, nextRetryAt, retryLimitReached, quality, audioProfile, setAudioProfile, offeredCodecs, negotiatedCodec`.

Fields that don't map to Verto (offered/negotiated codec details, ICE quality stats) get sensible defaults; call quality is derived from the underlying `RTCPeerConnection` Verto exposes via `dialog.rtc.getPeer()`.

### 4. Dispatcher: `src/hooks/useSoftphone.ts`
Update the public `useSoftphone` to a 3-way dispatch:

```text
Capacitor.getPlatform() === 'ios' + NATIVE_SIP_ENABLED → useSoftphoneNative (PJSIP)
Capacitor.getPlatform() === 'android'                  → useSoftphoneVerto
otherwise (web / dev)                                  → useSoftphoneJsSip
```

Android no longer touches JsSIP or the ICE/TURN path.

### 5. Config plumbing (`src/MobileApp.tsx`)
Add Android-specific SIP endpoint config:

```text
VERTO_HOST = 'pbxnode.lemtel.tel'
VERTO_PORT = 8082
```

Pass `{ host, port, login: extension, password: sipPassword, caller_id_name, caller_id_number }` from `creds` into `useSoftphone` on Android. Keep the existing `SIPConfig` path for iOS/web unchanged.

### 6. TURN fetch skip on Android
In `src/lib/sip/iceServers.ts` / `rtcConfig.ts`, short-circuit `getIceServers()` on Android so the app no longer calls `get-turn-credentials`. Removes the DNS-blocked path entirely.

### 7. SIP debug panel
`SipDebugPanel.tsx` currently reads JsSIP events. Add Verto events to the same ring buffer so the debug screen still shows `connecting → registered → call → hangup` transitions on Android.

### 8. Tests
- Add `apps/ava-softphone-mobile/src/lib/sip/vertoProvider.test.ts` covering: connect success, connect failure, outbound call state transitions, DTMF, hangup.
- Update `useSoftphone`-level tests to cover the Android → Verto dispatch branch.

### 9. Native permissions
No AndroidManifest changes required — mic permission is already declared. `WakeLock`/`WifiLock` foreground service (`SipConnectionService.kt`) is kept: Verto still runs a long-lived WebSocket that needs to survive doze.

## Files touched
- `apps/ava-softphone-mobile/src/lib/sip/vertoProvider.ts` (new)
- `apps/ava-softphone-mobile/src/hooks/useSoftphoneVerto.ts` (new)
- `apps/ava-softphone-mobile/src/hooks/useSoftphone.ts`
- `apps/ava-softphone-mobile/src/MobileApp.tsx`
- `apps/ava-softphone-mobile/src/lib/sip/iceServers.ts`
- `apps/ava-softphone-mobile/src/lib/sip/rtcConfig.ts`
- `apps/ava-softphone-mobile/src/components/SipDebugPanel.tsx`
- `apps/ava-softphone-mobile/src/vendor/verto/{jquery.min.js, jquery.jsonrpcclient.js, verto.js}` (new, vendored)
- `apps/ava-softphone-mobile/src/lib/sip/vertoProvider.test.ts` (new)

## After merge
User runs on their machine:
```text
cd apps/ava-softphone-mobile
npm run build
npx cap sync android
npx cap run android
```

## Open questions
1. **Vendor or CDN for `verto.js`?** I recommend vendoring so the Capacitor app has no boot-time dependency on the PBX for its own JS. Confirm OK.
2. **Password source.** Verto needs the raw SIP password. Confirm `creds.sipPassword` (or whichever field currently feeds JsSIP `password`) is the right one to reuse — no separate Verto password expected.
3. **Inbound calls.** Should Android continue to accept push-initiated inbound calls via the existing FCM/push path, with Verto answering when the socket is live? (Assumption: yes, same flow, Verto just replaces the media layer.)
