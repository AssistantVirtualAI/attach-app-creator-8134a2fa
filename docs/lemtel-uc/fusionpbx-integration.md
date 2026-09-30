# FusionPBX integration — inputs required from the PBX owner

- Test tenant/domain and two non-production extensions
- Permitted integration method (API/event feed — no UI scraping, no client-side admin login)
- Allowlisted Lemtel Edge public IP(s) or private/VPN link
- SIP transport (TLS), SRTP policy, codecs, registration model (upstream registration vs trusted trunk)
- CDR, voicemail and recording metadata access method (tenant-scoped)
- One test DID and a permitted outbound route
- Recording consent, retention and deletion policy; who may see transcripts/AI insights
