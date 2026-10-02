# Lemtel Phase 20A — Threat model

| Threat | Control |
|---|---|
| Direct table read from the browser | Table has RLS and no grant to anon/authenticated; portal uses only the JWT function. |
| Cross-organization listing | Server checks `is_lemtel_admin` or `user_roles` (`org_admin`/`super_admin`) for the exact requested organization; UI checks are not trusted. |
| Unauthenticated access | `verify_jwt = true` plus `auth.getUser()`; missing token returns 401. |
| Data overexposure | Fixed column list and strict response mapping; no IDs, user, hash, credential, endpoint, call or media data. |
| Input reflection / injection | Strict body validation (exact keys, UUID) before any database query; error codes never echo input. |
| Unintended mutation | Only `revoke_device`, one device per call, optimistic concurrency, audited; explicit UI confirmation. No approve, re-enable, delete or bulk. |
| False sense of security | UI and docs state that published apps do not consume the lifecycle yet; no immediate disconnection promised. |
| Scope creep | No Mobile/Desktop, PBX, FusionPBX, signaling, DNS/TLS, VPS or store changes; Planiprêt isolation guard runs before and after. |
