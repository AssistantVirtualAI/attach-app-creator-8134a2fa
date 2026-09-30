# Lemtel UC — first vertical slice in an isolated area

## What you will get
- A separate **Lemtel UC** section at its own address (`/lemtel-uc`), with its own login, look and data. Nothing in Planiprêt, the Planiprêt mobile app or the existing Lemtel PBX pages changes.
- **End user**: dashboard (extension, connection status, recent calls, voicemail, unread messages), calls (dialer model + history), contacts/favorites, messages, voicemail & recordings (shown only when policy allows), settings (profile, devices, notifications, sign-out).
- **Tenant admin**: users, extension mapping, devices, features, PBX connection health, provisioning jobs, audit log.
- **Platform admin**: tenant list and lifecycle, feature flags, high-level health.
- Demo flow: a tenant admin creates a user + extension mapping → the user signs in, adds a device, sees "proxy credential: issued" (never the secret), receives simulated call/voicemail events. Tenant A can never see Tenant B.
- Live calling stays **off** until the Lemtel Edge server (Kamailio/RTPengine on a VPS) and FusionPBX values from Kenny and Phil exist. The app says so clearly.

## Isolation guarantees
- New database tables all start with `luc_`; new backend functions all start with `luc-`; new screens live only under `src/pages/lemtel-uc/` and `src/components/lemtel-uc/`.
- No reads/writes to any `planipret_*`, `pp_*`, `pbx_*` or existing Lemtel tables. No edits to `apps/`, native code, SIP/PJSIP, CallKit/PushKit, telephony functions, DIDs, secrets, scheduled tasks or app versions.
- Only shared touch point: one new route line added in the app's route list (outside the locked `/mplanipret` block).

## Technical section
- **Schema (one migration, GRANTs + RLS on each):** `luc_tenants`, `luc_memberships` (user, tenant, role enum `luc_role`: platform_admin, tenant_admin, tenant_support, end_user — separate table, never on profile), `luc_devices`, `luc_pbx_connections` (only `credential_ciphertext`, never readable by clients — exposed through a `luc_pbx_connections_safe` view), `luc_extension_mappings`, `luc_feature_flags`, `luc_contacts`, `luc_conversations`, `luc_conversation_members`, `luc_messages`, `luc_call_events`, `luc_voicemails`, `luc_recordings`, `luc_provisioning_jobs`, `luc_push_registrations`, `luc_audit_events`.
- Security-definer helpers `luc_has_role(uid, tenant, role)`, `luc_is_member(uid, tenant)`, `luc_is_platform_admin(uid)`; every policy scoped by tenant. Audit trigger on every mutation into `luc_audit_events`.
- **Backend functions:** `luc-provision` (create user + mapping, encrypt PBX credential with AES-GCM using a new generated secret `LUC_CRED_KEY`), `luc-device` (enroll/revoke, issue short-lived device credential status), `luc-edge` (contract endpoints: INVITE push trigger, registration health callback — signature-checked, mocked), `luc-pbx-adapter` (FusionPBX interface with mock implementation: validate, sync extensions, CDR/voicemail/recording metadata). All validate the session in code and the caller's tenant role.
- **Frontend:** typed API client, mock event adapter, dark/light tokens scoped to `.lemtel-uc-scope`, responsive, loading/empty/error states.
- **Docs/infra (text only):** `docs/lemtel-uc/architecture.md`, `fusionpbx-integration.md`, `security.md`, `infra/lemtel-edge/README.md`, `infra/docker-compose.dev.yml`, `lemtel-uc.env.example` (placeholders only).
- **Tests:** cross-tenant denial and "no secret in responses" tests; build must pass.
- Record the isolation rule in AGENTS.md.

## Not included now
- Actual SIP proxy, real FusionPBX connection, real APNS/FCM pushes, native Lemtel mobile app — these need the VPS and the inputs listed in section 10 of your document.
