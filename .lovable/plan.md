# Lemtel — Inbound External Calls, Background Ring, Multi-Device Fork

Goal: External PSTN calls ring reliably on Android + iOS + Desktop softphone **at the same time**, even when mobile apps are in background / screen locked, with both mobile apps staying registered 24/7.

## 1. FusionPBX — Enable simultaneous ring (fork)

Root cause today: each device registers with the **same AOR** but different `+sip.instance`, and the dialplan sends `INVITE user@domain` which FreeSWITCH resolves to a single contact. We need parallel fork.

- Edge function `pbx-configure-multidevice`:
  - For each extension, set `dial_string` = `{presence_id=${dialed_extension}@${domain_name}}${sofia_contact(*/${dialed_extension}@${domain_name})}` (the `*/` prefix forks to **all registered contacts**).
  - Set `call_timeout=35`, `sip_force_expires=120` so short-lived mobile registrations are refreshed frequently enough to be included in fork.
  - Ensure `missed_call` only fires when **all** legs fail (not first-to-fail).
- Verify per-extension: `user_record=all`, `hangup_after_bridge=true`.

## 2. External DID → Extension routing

- Inbound route for each DID must target the extension (not a ring group) so the fork above applies.
- Add fallback ring group `<ext>-mobile` with strategy `simultaneous`, timeout 30s, members = `user/<ext>@domain` only, used if we ever need to force-include mobile.

## 3. Registration persistence (already partly done, harden)

Android (`SipConnectionService.kt`):
- Confirm foreground service `startForeground` runs at boot (`BOOT_COMPLETED` receiver).
- WakeLock + WifiLock held.
- Verto/PJSIP re-REGISTER on `ConnectivityManager` network change.
- Alarm-based keepalive every 25s via `AlarmManager.setExactAndAllowWhileIdle` (survives Doze).

iOS (`CapacitorSip.swift` / `AppDelegate.swift`):
- PushKit VoIP token registered on every launch and pushed as SIP contact param `pn-voip-tok`.
- `BGProcessingTask` schedules re-REGISTER every 20 min.
- On PushKit incoming, report to CallKit **within 5s** (Apple requirement) then trigger SIP INVITE handling.

Server: `pbx-push-config` edge function writes per-device push params to `sofia` contact so FreeSWITCH `mod_push` wakes the phone before sending INVITE.

## 4. Desktop softphone sync

- Ensure desktop app registers with distinct `+sip.instance=<uuid-desktop>` and same AOR/extension.
- Confirm `sofia_contact(*/...)` returns both mobile + desktop contacts (query `show registrations` via `pbx-list-registrations` edge function to validate).
- Add admin page badge: "N devices registered" per extension.

## 5. Incoming call UI revival

- Android: `Full-Screen Intent` notification with high-priority channel (already scaffolded) — verify `USE_FULL_SCREEN_INTENT` permission declared (Android 14+).
- iOS: `CXProvider.reportNewIncomingCall` on every PushKit event; if SIP INVITE doesn't arrive within 8s, end call with reason `.failed` so CallKit UI clears.
- Both platforms: play ringtone via native (not WebAudio) so it works while JS bridge is asleep.

## 6. Diagnostics

- Extend `SipDebugScreen.tsx` with:
  - Registered contacts list (from FusionPBX API).
  - Last INVITE received timestamp.
  - Push token status (APNs VoIP / FCM).
- Add admin page `PATelephonyForkDiag.tsx`: pick extension → show all registered contacts + test-call button.

## Deliverables

1. Migrations / SQL: none (config only).
2. Edge functions: `pbx-configure-multidevice`, `pbx-list-registrations`, `pbx-push-config`.
3. Native: Android boot receiver + AlarmManager keepalive; iOS BGProcessingTask + PushKit hardening.
4. UI: fork diagnostics page, per-extension "N devices" badge.
5. Docs: `/docs/telephony/multidevice.md` explaining fork + push flow.

## Test matrix

| Scenario | Expected |
|---|---|
| External DID → ext 300, desktop + iOS + Android all registered | 3 devices ring simultaneously |
| iOS app in background, screen locked | CallKit incoming UI within 5s |
| Android app killed by user | FCM/foreground service revives, ring within 6s |
| One device answers | Others stop ringing (CANCEL) |
| Wi-Fi → LTE handover mid-idle | Re-REGISTER within 10s, still receives calls |

Approve to implement in staged commits (server config → native hardening → UI).
