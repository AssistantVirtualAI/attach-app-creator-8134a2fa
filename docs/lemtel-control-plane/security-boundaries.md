# Lemtel Control Plane — security boundaries (Phase 1)

Forbidden in Phase 1 (never accepted, stored, logged or seeded):

- PBX / FusionPBX / SIP credentials, device or Edge credentials
- customer identities, tenants, users, extensions, phone numbers, email addresses
- application user tokens / JWTs
- recordings, CDRs, voicemail, messages, transcripts
- push tokens (APNS/FCM) and any external-service credential

Rules:

- Server-to-server only: one bearer token (`CONTROL_PLANE_SERVICE_TOKEN`) from the runtime environment. Never shipped to a browser, mobile or desktop app. No CORS.
- Desktop and mobile clients never receive a FusionPBX password from this control plane, now or later.
- Later user-facing access to calls, recordings and voicemail will be per-extension only and tenant-scoped.
- Logs redact authorization, cookie, password, secret, token, credential, sip, pbx, api_key and URL userinfo.
- Configuration fails closed on missing, default-looking, weak or malformed values; errors name the setting, never the value.
- Database: least-privilege design — production uses a migration owner role for `npm run migrate` and a separate application role limited to `INSERT, SELECT` on `control_plane_audit_events`; never a superuser. Local Compose uses a single development user for convenience only.
