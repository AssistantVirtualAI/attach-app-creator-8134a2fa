# Lemtel — Phase 16: Portal-to-Client Configuration Contract

Status: offline, non-executable contract. Base `f23191c71`. Nothing in this phase changes the portal, the iOS/Android app (`apps/ava-softphone-mobile/`), the Electron desktop app (`apps/ava-softphone-desktop/`), FusionPBX, Maestro, Edge, any server, DNS, TLS, database, device state or calling behavior.

Files:
- `schemas/lemtel-client-config/lemtel-client-config-manifest-v1.schema.json` — strict Draft 2020-12 manifest schema (`lemtel_client_config_manifest_v1`).
- `schemas/lemtel-client-config/lemtel-client-config-policy-v1.json` — non-secret policy literals (`lemtel_client_config_policy_v1`).

## Authority

The existing Lemtel portal remains the authoritative source for organization, domain, user and extension; mobile/desktop platform access; device approval and revocation; DND; forwarding; recording and voicemail policy; and the configuration revision.

## What a client receives

Future mobile and desktop clients receive only manifest references (opaque IDs and revisions), enums and booleans. The manifest never carries an endpoint, hostname, address, URL, password, token, secret, API key, phone number, contact data, call detail, recording, voicemail, transcript or audio location. SIP credentials are retrieved only through the existing separate authenticated server-side path (`credentialDelivery: separate_authenticated_server_flow`); the manifest holds only `credentialRevisionRef`.

## Routing

Direct routing (`direct_current`) remains active and is the only fallback. Edge is represented only as contract state; `edgeFeatureGate` is the literal `false` and `edgeRouteEnabled` is `false`. Verto is not allowed.

## Future capabilities

Microsoft sign-in, Maestro sync and AVA call/SMS actions are represented only as safe capability labels. `ready` or `requires_user_confirmation` is only a configuration label — it does not send SMS, place a call, provision SSO or create a network connection. `maestroEventsExecutable` and `avaActionsExecutable` are `false`.

## Revisions

Every portal mutation must increment the matching revision: `manifestRevision` for configuration, `deviceRevision` for device approval/revocation, `credentialRevisionRef` for credential rotation. Clients compare revisions to refresh safely; an expired manifest (`expiresAt`) or a revoked device triggers `revocationBehavior`.

## Refresh behavior

Background and foreground refresh is bounded (`backgroundRefreshMinimumIntervalSeconds` ≥ 300). A refresh must never create a duplicate SIP client, must never trigger a two-second full-screen reload loop (`repeatedFullPageReloadAllowed: false`), and must not reprocess the same item through AI twice (`aiDuplicateProcessingAllowed: false`).

## Speaker

Speaker remains a manual user choice (`speakerAutoEnableAllowed: false`).

## Privacy

Extension-only privacy (`own_extension_only`) is mandatory for calls, recordings, voicemail and transcripts, even for organization and domain administrators (`extensionAdminBypassAllowed: false`).

## Next phase

Phase 17 will implement the Lemtel-only server-side manifest/device lifecycle and must still not connect a new PBX route.
