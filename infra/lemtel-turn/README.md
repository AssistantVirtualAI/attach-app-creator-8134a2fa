# Lemtel TURN relay (decision D2 — hosted by Lemtel, nothing to install on FusionPBX)

**Status: prepared, not deployed.** Calls from phones behind strict NAT / corporate firewalls need a media relay.
Lemtel runs it (coturn) on its own writer, so Kenny and Phil have nothing to change on FusionPBX.

- Credentials: coturn `use-auth-secret`. The shared secret is entered once in the portal (*Connexion FusionPBX →
  Secret partagé TURN*, stored encrypted); `lemtel-softphone-provisioning` hands each app short-lived TURN
  credentials (HMAC, `turnCredential()` in `_shared/lemtelPbxConnection.ts`). No static TURN password in any app.
- Listeners: TURN over TLS 5349 (works through most firewalls) and UDP/TCP 3478; relay ports 49160–49200/udp.
- DNS needed before deployment: `turn.assistantvirtualai.com` → DO writer (A record, DNS only / grey cloud).
- Portal values after deployment: TURN `turns:turn.assistantvirtualai.com:5349?transport=tcp`, STUN
  `stun:turn.assistantvirtualai.com:3478`.
