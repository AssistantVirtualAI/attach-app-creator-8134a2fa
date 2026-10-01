# Lemtel Edge - Phase 2 offline template package

This folder is an offline, inert template package. It is not a deployable stack: no service, container, listener or network path is created from it.

- Selected future components only: Kamailio (signalling), RTPengine (media), an approved TLS terminator in a later phase, and an approved Control Plane integration in a later phase.
- `config/`: inert Kamailio and RTPengine templates (default deny, static 503, loopback placeholders only).
- `policy/`: static network policy and feature gates. Every gate is `false`.
- `edge.env.example`: future variable names only, all blank.
- Event schemas live in `schemas/lemtel-edge/`; documentation in `docs/lemtel-edge/`.

Pending gate: the Phase 1 Docker runtime validation from `docs/lemtel-control-plane/local-development.md` is still pending. It must pass before any Edge container, deployment, FusionPBX integration, client cutover or pilot call.
