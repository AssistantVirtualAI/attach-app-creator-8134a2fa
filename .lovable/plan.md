# Fix Lemtel mobile Settings — full interactivity + noise cancellation + auto network switching

Scope is limited to `apps/ava-softphone-mobile/` (Lemtel mobile app). No other apps or backends are touched.

## Problem
On the Settings screen:
- Several rows do nothing or open browser `prompt()`/`confirm()` dialogs, which don't work in the Capacitor WebView on iOS/Android → they look broken and can't change anything.
- Ringtone, audio output, forwarding, cache-clear are behind these broken prompts.
- Toggles fire but don't show an "on" active state everywhere.
- No control over noise cancellation.
- No user control over Wi-Fi ↔ LTE handover (there is auto-reconnect code but no UI, no signal-based switching, no way to disable it).

## What will change

### 1. Replace all browser prompts with native-friendly bottom sheets
File: `src/screens/SettingsScreen.tsx`
- New reusable `<PickerSheet>` and `<InputSheet>` components (small, in-file).
- Replace `prompt()`/`confirm()` for: **ringtone**, **audio output**, **forwarding number**, **clear cache**, **about**.
- Every row becomes tappable with a visible right-side chevron/switch and current value.

### 2. Wire settings to the real subsystems (currently unwired)
- **Ringtone** → save to `ava.ringtone`, and call the existing `ringPreferences` API used by `incomingRingtone.ts` so it actually plays on next incoming call.
- **Audio output** → call `audioOutput.setRoute('speaker'|'earpiece'|'bluetooth')` from `src/lib/sip/audioOutput.ts` (already implemented, just not called here).
- **Haptics**, **Auto-answer**, **Announce recording**, **Claude fallback** → already persist; add correct `Switch on={value}` binding and toast confirmation.
- **Notifications** row → open native app settings (already correct) + show current permission chip.

### 3. New "Audio Quality" section — noise cancellation
New file: `src/lib/audioPrefs.ts`
- Keys: `ava.nc_enabled` (default `on`), `ava.nc_mode` (`standard | office | phone`).
- Export `getAudioConstraints()` returning `MediaStreamConstraints` (mirrors the pattern already used in `src/lib/planipret/audio/audioConstraints.ts` but scoped to Lemtel mobile).

File: `src/hooks/useSoftphone.ts`
- Replace the hard-coded `HD_AUDIO_CONSTRAINTS` with `getAudioConstraints()` so the toggle/mode actually change what's captured on the next call.
- When NC is off → `echoCancellation/noiseSuppression/autoGainControl` set to `false`.
- Modes: `standard` = 16 kHz + NS on, `office` = 16 kHz + extra Chromium hints (typing/highpass), `phone` = 8 kHz for weak cellular.

UI in Settings (new section):
- Toggle **Noise cancellation** (default on).
- 3-button segmented mode selector (Standard / Bureau / Téléphone) — hidden when NC is off.

### 4. New "Réseau" section — auto Wi-Fi/LTE handover
Uses existing `@capacitor/network` (already installed, used by `nativeAutoReconnect.ts`).

New keys in `audioPrefs.ts`:
- `ava.autoHandover` (default `on`) — controls automatic re-registration on network change.
- `ava.preferWifi` (default `on`) — when both are up, prefer Wi-Fi.
- `ava.backgroundCalls` (default `on`).

File: `src/lib/sip/nativeAutoReconnect.ts`
- Gate the debounced `scheduleReconnect(..., 'networkStatusChange')` on `ava.autoHandover`.
- On `networkStatusChange`, if new type differs from previous (Wi-Fi ↔ cellular) → trigger reconnect (this is the "auto-detect best signal" behaviour on mobile; iOS doesn't let apps pick the radio, so we react to every handover which effectively re-registers on whichever link currently has connectivity).
- Log previous vs next type to the SIP log so diagnostics show the switch.

UI in Settings (new section):
- Toggle **Basculement automatique Wi-Fi / LTE**.
- Toggle **Préférer Wi-Fi quand disponible**.
- Toggle **Appels en arrière-plan**.
- Live status row: current network (Wi-Fi / Cellular / Offline) + connection quality dot, refreshed via `Network.addListener('networkStatusChange')`.

### 5. i18n
File: `src/lib/i18n.tsx`
- Add keys (fr + en) for: `settings.audioQuality`, `settings.noiseCancel`, `settings.ncStandard/Office/Phone`, `settings.network`, `settings.autoHandover`, `settings.preferWifi`, `settings.backgroundCalls`, `settings.currentNetwork`.

## Out of scope
- No changes to the Planipret mobile app (isolation-locked memory).
- No changes to desktop, web portal, edge functions, or DB.
- No native plugin changes — everything ships in the JS bundle and takes effect on the next `npx cap sync` the user does anyway.

## Files touched
```text
apps/ava-softphone-mobile/src/screens/SettingsScreen.tsx   (rewrite interactions, add 2 sections)
apps/ava-softphone-mobile/src/lib/audioPrefs.ts            (new)
apps/ava-softphone-mobile/src/hooks/useSoftphone.ts        (use getAudioConstraints)
apps/ava-softphone-mobile/src/lib/sip/nativeAutoReconnect.ts (respect autoHandover pref, log switch)
apps/ava-softphone-mobile/src/lib/i18n.tsx                 (new keys)
```

## Verification
- `tsgo` clean.
- Manually: open `/` in mobile preview → Settings → every row now opens a sheet or toggles visibly; NC + Network sections render; toggling NC mode is persisted across reload.
