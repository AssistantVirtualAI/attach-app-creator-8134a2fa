# Lemtel Edge (separate VPS deployment — not part of this web app)

Components: Kamailio or OpenSIPS (TLS/WSS registrar + proxy), RTPengine (SRTP relay), TLS certs (Let's Encrypt) for `edge.<lemtel-domain>`.

Firewall: 443/tcp (WSS), 5061/tcp (SIP TLS), RTP range (e.g. 30000–40000/udp). FusionPBX accepts traffic only from Edge IPs.

Callbacks to the control plane (`luc-edge`), signed with `LUC_EDGE_SECRET`:
- `{ "event": "invite_push", "tenant_id": "...", "extension": "1001" }`
- `{ "event": "registration_health", "tenant_id": "...", "extension": "1001", "state": "registered" }`

Use placeholders only; real PBX values stay in the VPS environment.
