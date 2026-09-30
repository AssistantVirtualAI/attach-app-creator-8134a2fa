# Lemtel UC — Security

- **Tenant isolation**: every `luc_*` row carries `tenant_id`; RLS uses security-definer helpers (`luc_is_member`, `luc_has_role`, `luc_is_staff`, `luc_is_platform_admin`). Functions re-check role server-side.
- **Roles** live in `luc_memberships` (never on a profile): platform_admin, tenant_admin, tenant_support, end_user. Clients cannot write memberships.
- **Secrets**: PBX/SIP/push credentials stored only as AES-GCM ciphertext (`LUC_CRED_KEY`). Clients have no column grant on ciphertext columns.
- **Audit**: trigger `luc_audit` records every mutation in `luc_audit_events`.
- **Edge**: HMAC-signed callbacks (`LUC_EDGE_SECRET`); TLS/SRTP enforced at Edge.
- Retention, backups and rate limiting to be configured per tenant policy before pilot.
