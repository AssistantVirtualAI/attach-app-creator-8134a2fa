# Lemtel Edge - security boundaries (Phase 2)

- Not part of any Phase 2 event or config: SIP/PBX credentials, raw caller identity, IP addresses, recordings, CDRs, voicemail, messages and push tokens.
- Default deny: the Kamailio template answers every request with a static 503. All feature gates are `false`.
- Future policy: TLS 1.2 or newer for SIP TLS/WSS; SRTP or DTLS-SRTP for media.
- Kamailio WebSocket CORS stays disabled (`cors_mode` 0). Future origins must be listed explicitly, never `*`.
- No external access is established here: no listener, no FusionPBX, no Control Plane, no push service.
- Event payloads carry opaque references only and reject any additional field.

Pending gate: the Phase 1 Docker runtime validation from `docs/lemtel-control-plane/local-development.md` is still pending. It must pass before any Edge container, deployment, FusionPBX integration, client cutover or pilot call.
