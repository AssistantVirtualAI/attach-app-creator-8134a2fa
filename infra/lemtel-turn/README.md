# Lemtel TURN relay (decision D2 — hosted by Lemtel, nothing to install on FusionPBX)

Calls from phones behind strict NAT / corporate firewalls need a media relay. Lemtel runs it (coturn) on the DO
writer, so Kenny and Phil have nothing to change on FusionPBX and organizations have nothing to enter in the portal.

- **Credentials**: coturn `use-auth-secret`. The shared secret is generated on the server by `lemtel-turn-install.sh`
  and kept only in `/etc/lemtel-turn/turnserver.conf` (root:nogroup 0640) and the functions `.env`
  (`LEMTEL_TURN_SHARED_SECRET`). `lemtel-softphone-provisioning` hands each app a 1-hour HMAC credential
  (`turnCredential()`); no static TURN password exists in any app, log or repository.
- **Precedence**: an organization that configures its own TURN in the portal (URLs + *Secret partagé TURN*) keeps it;
  otherwise the Lemtel-hosted relay (`LEMTEL_TURN_URLS`, `LEMTEL_STUN_URLS`) is used (`platformIce()`).
- **Listeners**: STUN/TURN 3478 UDP and TCP on 192.241.137.143; relays 49160–49200/udp. No TLS listener
  (443 stays with Caddy); TURN-over-TLS can be added later with a certificate for a DNS-only hostname.
- **Safety**: relays only to public addresses (private, loopback, link-local, CGNAT and Lemtel's own servers denied),
  UDP relays only, per-user and total quotas, no admin CLI.
- **Failover**: the relay lives on the DO writer. While Hostinger serves, calls still work directly; only callers
  behind very strict NAT lose the relay until DO is back.
- **Install**: `lemtel_turn_push_deploy.sh` (Mac launcher) runs `lemtel-turn-install.sh check`, asks GO, then
  `deploy`, then recreates the functions so the new values are live, and tests STUN from the Mac.
- **Firewall**: the installer opens the ports in `ufw` when it is active. If the DigitalOcean cloud firewall is used,
  allow 3478/udp, 3478/tcp and 49160–49200/udp inbound for the droplet.
