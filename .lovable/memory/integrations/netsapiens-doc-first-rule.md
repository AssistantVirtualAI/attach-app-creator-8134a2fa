---
name: NetSapiens doc-first rule (Planiprêt)
description: For any Planiprêt telephony/SIP change, always base the fix on NetSapiens NS-API docs in docs/netsapiens/ before coding
type: preference
---

For the Planiprêt app (mobile + portal), ALWAYS base telephony/SIP/answering-rule/device fixes on the NetSapiens documentation first (`docs/netsapiens/`: devices, registrations, answerrules, phonenumbers, calls, cdr, voicemail). No blind fixes.

**How to apply:** read the relevant doc file, quote the exact field/endpoint used, then change code. If a field isn't documented, say so instead of guessing.

Known platform facts:
- Device registration state lives on the Device object (`device-sip-registration-*`), no `/registrations` resource.
- Core nodes (`core*.cluster*.ucstack.io`) drain client registrations → WSS close 1001. Clients must register on the SBC edge `voice.ava-telecom.ca:9002`, even though the portal shows `Outbound Proxy: core1.cluster1.ucstack.io`.
- Multiple AORs on one user (`113`, `113_mobile`, `113_web`) require SimRing/`ring-all-user-phones` in the answering rule, otherwise inbound goes straight to voicemail.
