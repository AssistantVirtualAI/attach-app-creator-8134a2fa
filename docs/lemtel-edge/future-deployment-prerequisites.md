# Lemtel Edge - future deployment prerequisites (checklist only)

No secret may be pasted into Lovable or chat, or committed to Git.

- [ ] Phase 1 Docker runtime test passed (`docs/lemtel-control-plane/local-development.md`) - currently pending
- [ ] Non-root VPS user with key-based access
- [ ] Private backup and tested restore plan
- [ ] Monitored log storage
- [ ] Secret manager selected
- [ ] Exact future DNS name chosen
- [ ] TLS certificate lifecycle defined
- [ ] Fixed public IP or private link
- [ ] Firewall rules written and reviewed
- [ ] SIP TLS / SRTP codec policy
- [ ] RTP UDP capacity estimate
- [ ] FusionPBX non-production tenant with two test extensions
- [ ] Allowed IP or private link towards FusionPBX
- [ ] Approved PBX integration method
- [ ] APNS / FCM accounts (later phase)
