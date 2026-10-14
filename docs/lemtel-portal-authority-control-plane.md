# Lemtel Portal — authoritative administration control plane

## Purpose

`/lemtel-portal/` is the single administrative source for Lemtel organizations, domains, users, invitations, access revocation and temporary-password recovery. The browser calls the Lemtel-only `portalApi`; the Edge Function validates the signed-in actor and applies server-owned authorization rules.

## Implemented control-plane scope

| Module | Authoritative path | Status |
|---|---|---|
| Organizations | `create_organization`, `list_organizations` | Ready in source |
| Domains | `list_domains`, `create_domain`, `suspend_domain` | Ready in source; schema migration `0008` pending separate target-write approval |
| Users | `provision_users`, `list_people` | Ready in source |
| Access | `revoke_invitation`, server session bootstrap | Ready in source |
| Password recovery | `lemtel-password-reset-request`, `resend_welcome` | Ready in source with server-generated temporary credentials |
| Mobile/Desktop authorization | `lemtel-session-bootstrap` and account-authority revision | Ready in source |
| Operations | Redacted `get_operational_status` | Read-only |

## Explicit non-scope until separate authorization

The portal does **not** create DNS records, change routing, start a PBX, provision SIP/WSS/TURN credentials, expose voicemail, change voice-mailboxes, manage recordings, or publish call history. The Communications screens are intentionally read-only and report `not provisioned` until a server-side source contract, approved provider inputs, and physical-device tests exist.

## Safe domain lifecycle

1. An organization administrator adds a hostname through the Lemtel portal.
2. The Lemtel server stores it as `unverified`; no public routing or DNS action occurs.
3. A future separately approved domain-verification workflow can mark it verified.
4. An organization administrator may suspend the Lemtel domain record. This changes no DNS or traffic.

## Deployment boundary

The code and migration are versioned only. Applying migration `0008`, deploying the Edge Function, configuring portal variables, or cutting over users requires a separate, explicit DigitalOcean target-write/deployment authorization, backup, validation and rollback plan.
