# Lemtel — secure node publication enrollment

**Source-only, disabled, publication-only.** No deployment, runtime key generation, installation, transport, remote command, promotion, DNS, runtime start or failover.

Protocol, authority boundaries, root-only file contracts, cryptographic assumptions, source inventory and future blockers: [NODE_SECURE_ENROLLMENT_PROTOCOL.md](../../../docs/lemtel-ha/NODE_SECURE_ENROLLMENT_PROTOCOL.md).

The local agent prepares keys/attestations/signed observations into root-only files. It never sends them. `check` is the only systemd action; service and timer have no `[Install]` section, require an absent local approval marker and cannot access a network. Future transport and activation require a separately approved change.

The new publication ingress authenticates a platform-admin-approved signing key, not a cloud-provider identity. Fingerprints are public displayable digests. A pending request is always unverified. No existing HMAC credential or failover credential is delivered, reused or read by this package.

`deployment-manifest.json` inventories source digests and all default-deny gates. It is not an authorization to deploy or activate.
