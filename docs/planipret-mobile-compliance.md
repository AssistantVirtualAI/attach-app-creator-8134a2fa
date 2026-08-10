# Planipret Mobile — VoIP, Security & Privacy Compliance

This document tracks how the `/planipret/mobile` app meets Apple App Store and Google Play VoIP + privacy requirements, and how ongoing changes must preserve that compliance.

## 1. Microphone permission (App Store §5.1.1 / Play policy)

- The app **never** calls `getUserMedia` on load. Access is requested only when the user taps *Call* (see `src/hooks/useMplanipretSoftphone.ts` → `placeCall` → `ensureMicPermission`).
- When permission is `denied` or `unavailable`, we show `MicPermissionDialog` explaining **why** we need the microphone and how to enable it. No call is placed until the OS returns `granted`.
- Native manifests must ship a purpose string:
  - **iOS `Info.plist`**: `NSMicrophoneUsageDescription = "Planipret needs access to your microphone to make and receive VoIP calls."`
  - **Android `AndroidManifest.xml`**:
    ```xml
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_PHONE_CALL" />
    ```
- Notifications for inbound VoIP:
  - iOS: PushKit + CallKit (VoIP push certificate, background mode `voip`).
  - Android: high-priority FCM + a foreground service typed `phoneCall` for the in-call UI.

## 2. VoIP transport & encryption

- **Signalling**: JsSIP over WSS (`wss://voice.ava-telecom.ca:7443`). TLS 1.2+ enforced by NS-API; no plain WS fallback.
- **Media**: SRTP negotiated by the NetSapiens SBC. WebRTC always produces DTLS-SRTP; we never disable it.
- **STUN/TURN**: use the connection's advertised `iceServers`. Never log ICE credentials.
- **Handover**: ICE restart on Wi-Fi ↔ LTE transitions (`handoverController.ts`) — SRTP keys are re-negotiated automatically.

## 3. Privacy & data handling

- Recording, transcription, and AI notes are opt-in via `PrivacyConsentGate` and mirror the `/planipret/admin` toggles.
- Call metadata is stored per-broker (RLS via `broker_id = auth.uid()`).
- No microphone stream is ever sent outside the SRTP session opened for the active call. No raw audio is uploaded to Supabase/Lovable Cloud.
- Local storage keys used by the mobile app (no PII): `pp_nc_enabled`, `pp_nc_mode`, `pp_auto_handover`, `pp_network_prefs`. Cleared on logout.


## 3bis. Third-party AI (App Store 5.1.1(i) / 5.1.2(i))

- No user data reaches an AI provider before explicit consent. Every AI call site awaits `ensureAiConsent()` (`src/components/planipret/mobile/AiConsentHost.tsx`), which shows `AiConsentGate` listing **what** is sent (messages to AVA, call transcripts/metadata, SMS/email text being improved, related contact name & number), **who** receives it (OpenAI, Google Gemini, Anthropic Claude for text; ElevenLabs for voice) and **what is never sent** (credentials, tokens, raw audio).
- Gated surfaces: AVA chat (`MAvaChat`, `AvaChatSheet`), AVA voice agent, proactive AVA (`avaProactive`), call coaching (`useCallAnalysis`), AI text improve (SMS/email), TTS brief playback (`BriefListenButton`).
- Consent is revocable at any time: *Plus → Consentement IA (AVA)*. Declining keeps the app fully usable.
- The privacy policy (`/mplanipret/privacy`, section 3bis) documents the same disclosure plus the equivalent-protection statement.

## 4. Security posture

- Auth: Supabase JWT in `httpOnly` cookies (session-based). No credentials stored on the device.
- SIP passwords come from `ns-resolve-sip-credentials` per user and are held in memory only.
- Screens display no secrets; the `NetworkQualityBadge` and `HandoverIndicator` render only network *type* and quality — never IPs or tokens.

## 5. App Store review checklist

- [x] Purpose strings for mic + network.
- [x] Explicit user consent for recording / transcription (mirrors admin settings).
- [x] Clear fallback UI when permissions denied (`MicPermissionDialog`).
- [x] Background VoIP handled via PushKit/CallKit on iOS.
- [x] No hidden mic capture — mic only opens after tap-to-call.
- [x] Privacy policy linked from `MMore` → *Privacy* row.

## 6. Play Store review checklist

- [x] Data-safety form declares: Audio (in-app only), Personal info (name/phone), App activity.
- [x] Foreground-service type `phoneCall` for active calls.
- [x] Runtime permission prompts (Android 6+) triggered on demand.
- [x] Target SDK ≥ current Play requirement.
