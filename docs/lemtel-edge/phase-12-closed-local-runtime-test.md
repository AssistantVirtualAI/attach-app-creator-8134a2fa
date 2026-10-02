# Lemtel Edge — Phase 12: Closed Local Runtime Test

Status: Phase 12A only creates and statically validates the package. It does not run Docker.

There is no live integration. A passing Phase 12 result does not enable Edge, PBX, Control Plane, client routing, SIP registration, media, apps, portal, deployment or a pilot. All ten gates remain false.

## Manual run (after independent review)

From the repository root, the user runs exactly one command:

```text
node scripts/run-lemtel-edge-phase12-closed.mjs
```

The user-approved Docker build may download only public Debian packages and the versioned base image.

## Runtime shape

- One unprivileged Kamailio container (user and group 65532).
- Docker network mode none, no host port, no volume, no host mount.
- Read-only root filesystem, all capabilities dropped, no-new-privileges, process and memory limits.
- Loopback listener inside the container only; a local static 503 reply is the only behaviour.
- No RTPengine, no media, no upstream, no registration, no authentication, no proxying.

## Report and cleanup

- Exactly one JSON report, matching the Phase 11 report schema, is emitted to stdout. Nothing is written to disk.
- Cleanup is mandatory: the container, its local resources and the temporary test image are removed in every case. Incomplete cleanup reports `cleanup_failed`.

## Next steps

Any actual PBX, upstream or client route change requires a new written approval and a later phase.
