# Lemtel Edge - Phase 5 FusionPBX prerequisites (checklist only)

Kenny and Phil must later provide these through an approved secure channel, never through Lovable, chat or Git:

- [ ] Approved non-production FusionPBX tenant scope
- [ ] Two non-production test extensions
- [ ] Approved adapter mechanism (API, database or event method) with least-privilege scope
- [ ] Private/allowlisted network path from the future Edge
- [ ] Server-side secret manager location and rotation owner
- [ ] Extension provisioning rules and device concurrency policy
- [ ] Allowed codecs, SIP TLS/SRTP policy, inbound/outbound call policy
- [ ] CDR, recording and voicemail synchronization ownership
- [ ] Test windows, rollback owner and incident contact

No secret value, connection detail or real extension identifier is requested or displayed here. No PBX access was requested or used in Phase 5.

Pending gate: the Phase 1 Docker runtime validation from `docs/lemtel-control-plane/local-development.md` is still pending. It blocks every runtime, deployment, integration, gate and pilot action.
