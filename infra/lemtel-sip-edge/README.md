# Lemtel SIP edge — call push gateway (phase 3.3)

**Status: prepared, not deployed.** Activation waits for decision **D1** (where the SIP password lives: device only,
or also at the Lemtel edge) and for the FusionPBX details from Kenny and Phil (6.11).

## Why an edge
FusionPBX/FreeSWITCH cannot wake a sleeping phone: it sends the INVITE to the last registered contact and, if the app
is suspended (iOS) or killed (Android), nothing rings. Ringotel solves this with its own SIP edge; Lemtel does the same,
without any change on the FusionPBX side:

```
FusionPBX ──INVITE──▶ Lemtel SIP edge (Kamailio, on the DO writer)
                         │ 1. ts_store(): hold the transaction
                         │ 2. signed HTTP POST ─▶ lemtel-push-notify ─▶ APNs VoIP (iOS) / FCM HIGH (Android)
                         │ 3. the woken app re-REGISTERs (iOS: AppDelegate → triggerReregister; Android:
                         │    LemtelPushService → full-screen ring → JsSIP registers)
                         └ 4. ts_append(): the held INVITE is forked to the fresh contact → the phone rings
```

## Pieces in the repository
| Piece | Path | State |
|---|---|---|
| Device registry (who to wake) | `migrations/0027_lemtel_push_devices.sql`, `functions/lemtel-push-register` | ready, tested |
| Push sender (APNs ES256 / FCM v1) | `functions/_shared/lemtelPush.ts`, `functions/lemtel-push-notify` | ready, tested (signature, replay, dead-token cleanup) |
| iOS | `AppDelegate.swift` (PushKit → CallKit → re-REGISTER), `CapacitorSip.getVoipPushToken` | ready |
| Android | `LemtelPushService.kt` (FCM data → foreground call service → full-screen ring) | ready |
| Apps ↔ server | `src/lib/lemtelCallPush.ts` (register at start, re-register on token rotation, unregister at sign-out) | ready, tested |
| Edge | `kamailio.cfg`, `docker-compose.lemtel-sip-edge.yml` | template (validated with `kamailio -c` at deployment) |

## Server secrets (never in Git)
- `LEMTEL_APNS_KEY_P8`, `LEMTEL_APNS_KEY_ID`, `LEMTEL_APNS_TEAM_ID` (Apple Developer → Keys → APNs, team of `com.lemtel.softphone`)
- `LEMTEL_FCM_SERVICE_ACCOUNT_JSON` (Firebase project of `google-services.json` → service account, role *Firebase Cloud Messaging API Admin*)
- `LEMTEL_PUSH_HOOK_SECRET` (64 hex, generated on the server, shared by the edge and `lemtel-push-notify` only)

## Decision D1 (needed before deploying the edge)
- **A — password on the device only (recommended to start):** the edge is a stateless proxy with Path; FusionPBX
  authenticates the apps directly. While an app sleeps its upstream binding may expire, so the edge answers FusionPBX
  for push-enabled users through a long-lived binding (`expires` raised by the edge for push contacts, RFC 8599).
- **B — password also at the edge (Ringotel model):** the edge keeps each push user registered to FusionPBX itself
  (`uac` registrations). Most robust ringing, but the SIP password must be readable by the edge.
