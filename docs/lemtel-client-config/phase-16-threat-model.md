# Lemtel — Phase 16 Threat Model (Client Configuration Contract)

| Threat | Contract-level preventive rule | Later implementation test required |
|---|---|---|
| Browser/client secret exposure | Schema has no credential, token, secret, authorization or API key field; `credentialDelivery: separate_authenticated_server_flow`; only `credentialRevisionRef`. | Manifest endpoint response contains no secret; client bundles and logs contain no credential. |
| Cross-extension CDR/recording/voicemail/transcript/audio leakage | All privacy scopes are the literal `own_extension_only`; cross-extension and admin bypass flags are `false`. | Server returns 403/empty for another extension's records, including for org/domain admins. |
| Stale or revoked device | `deviceState`, `deviceRevision`, `deviceAction`. | Revoked device stops SIP and cannot fetch credentials. |
| Replayed/expired manifest | `manifestRevision`, `issuedAt`, `expiresAt`. | Client rejects manifests older than its stored revision or past `expiresAt`. |
| Platform access disabled but local session retained | `accountState`, `mobileEnabled`, `desktopEnabled`, `revocationBehavior`. | Disabling access clears the local session and unregisters SIP on next refresh. |
| Unauthorized Edge routing | `edgeFeatureGate` const `false`; `fallbackMode` const `direct_current`; no endpoint fields; `edgeRouteEnabled: false`. | Client ignores any Edge state and keeps direct routing. |
| Verto reintroduction | `vertoAllowed: false`. | Static scan proves no Verto code path is reachable. |
| Duplicate SIP initialization | Refresh contract forbids duplicate SIP clients. | Repeated refresh/resume keeps exactly one SIP user agent. |
| Unbounded refresh/polling | `backgroundRefreshMinimumIntervalSeconds` ≥ 300; `repeatedFullPageReloadAllowed: false`. | Timer test proves minimum interval and no full-screen reload loop. |
| Arbitrary AVA call/SMS action | Capability states are labels only; `avaActionsExecutable: false`, `maestroEventsExecutable: false`. | No call/SMS is sent without explicit user confirmation in a future approved phase. |
| Malicious unknown JSON properties | `additionalProperties: false` on every object; strict policy keys. | Server and client reject manifests with unknown properties. |
