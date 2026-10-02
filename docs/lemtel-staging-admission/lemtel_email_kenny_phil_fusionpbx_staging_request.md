# Email draft — Lemtel self-hosted staging

To: Kenny; Phil
Subject: Lemtel self-hosted staging — confirmation required for the new integration layer

---

Hi Kenny, hi Phil,

A quick status and a narrow request.

## Where things stand today

- Lemtel is already connected to FusionPBX today.
- The production architecture already uses an authenticated server-side FusionPBX v7 API proxy for tenant administration, extension/device management, CDRs, voicemail, recordings, registration status, call controls and synchronisation.
- The existing desktop and browser softphones obtain user-scoped SIP credentials from the Lemtel backend and register directly to the existing secure WSS/SIP service.
- The existing direct route remains active and unchanged.
- The Hostinger staging infrastructure is separate and is not connected to FusionPBX, DNS, client traffic or production calling.

## Preparation already completed

- The existing Lemtel apps, portal, direct route and Planiprêt were preserved.
- Offline tenant, device, routing, credential, provisioning, rollback and PBX-adapter contracts were created.
- An inert local Edge test was validated with no external egress, no PBX, no Control Plane, no media relay and no enabled gate.
- The dedicated staging VPS was hardened: non-root key-only administration, firewall, security updates, Docker, weekly provider backups and a fresh-pre-change-snapshot procedure.
- A separate encrypted off-server backup target and a recovery test were prepared.
- A monitoring owner, a log-retention decision and a secrets owner were defined. The staging admission policy remains denied.

## What we need from you — written approvals/decisions only

1. Approval for a **separate least-privilege non-production service account** to use the established FusionPBX v7 REST/API model from the future staging adapter.
2. A dedicated non-production domain/tenant, two test extensions, an optional test DID and a restricted test outbound dial plan, with no production customer data.
3. The required network boundary for the new VPS: IP allowlisting, VPN, mTLS or another approved method; any allowed callbacks/events; and the emergency revocation/rollback procedure.
4. Choice of first adapter scope:
   - **Option A — data/provisioning only** (recommended): non-production tenant, extensions/devices, and authorised CDR/voicemail/recording metadata, while existing direct WSS/SIP calling remains unchanged.
   - **Option B — future signaling/media pilot**: requires a separate design/security approval and is not part of this request.
5. The approved non-production data scope for registration status, CDRs, voicemail, recordings and any events, including consent, retention, deletion, AI/transcript and access-control conditions.
6. The PBX-side technical owner, the rollback contact and the non-production pilot acceptance criteria: registration, inbound/outbound calls, two-way audio, DTMF, hold, transfer, decline/hangup, voicemail behaviour and direct-route rollback.

## Security rule

Please do not send SIP passwords, API keys, SSH credentials, database credentials, private keys, production files or customer data by email. Any future staging credential will be created separately with least privilege and exchanged through an approved secure channel.

## Next steps after your reply

1. Document the approved non-production adapter contract against the existing integration.
2. Keep existing applications and direct WSS/SIP unchanged.
3. Prepare the staging configuration offline, with no credentials in Git, Lovable, email or client code.
4. Obtain separate private DNS/TLS approval.
5. Create a fresh Hostinger snapshot immediately before any approved deployment change.
6. Privately deploy the Control Plane and validate health, monitoring, logs and encrypted backup recovery.
7. Run a disabled Edge-only test with no PBX traffic.
8. Connect only the explicitly approved non-production API/service account and validate revocation, audits and rollback.
9. Conduct a two-extension staging test.
10. Seek separate written approval before any signaling/media pilot, client routing change, customer migration, store release or production rollout.

Thank you,

Mohamad Hassoun
AVA
mhassoun@assistantvirtualai.com
