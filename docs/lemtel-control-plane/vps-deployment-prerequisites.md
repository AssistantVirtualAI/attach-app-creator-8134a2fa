# Lemtel Control Plane — VPS deployment prerequisites (checklist only)

Nothing is deployed in Phase 1. No secret should ever be pasted into Lovable or committed to Git.

- [ ] VPS operating system access confirmed by the owner
- [ ] Non-root deploy user with SSH keys (no password login)
- [ ] Public IP assigned
- [ ] Subdomain chosen
- [ ] DNS record planned (not created yet)
- [ ] Firewall policy written (only 443 public; Postgres/Redis never public)
- [ ] TLS strategy (Caddy or equivalent reverse proxy, automatic certificates)
- [ ] Backups for the Control Plane PostgreSQL volume, with a restore test
- [ ] Monitoring and an alert destination
- [ ] FusionPBX test tenant with two test extensions
- [ ] Owner-approved PBX integration method
- [ ] Edge ↔ PBX network allowlisting plan
- [ ] APNS / FCM accounts (later phase)
