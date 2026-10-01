# Lemtel Edge - preflight report contract

`--report` emits exactly one JSON object with these keys, in this order:

- `phase`: `3`
- `result`: `static_preflight_passed`
- `runtime`: `not_started`
- `phase1_docker_runtime`: `pending`
- `inputs`: lowercase hex SHA-256 values, in this order
  - `kamailio_cfg_sha256`: kamailio.cfg, kamailio-local.cfg, kamailio-tls.cfg.example
  - `rtpengine_cfg_sha256`: rtpengine.conf, rtpengine-local.conf
  - `edge_policy_sha256`: edge-network-policy.yaml, edge-feature-gates.yaml, edge.env.example
  - `event_schema_bundle_sha256`: the envelope, registration-health and invite-push schemas
- `checks`: stable check IDs, sorted

## Hashing scope

Each group hashes only the content of its fixed committed inputs, in the order listed, each prefixed by its input ID and byte length. The same inputs always give the same values.

## No sensitive output

The report holds no timestamp, random ID, host, user, environment value, pathname, raw configuration, secret or private data. A failed run prints only check IDs.

## What the report proves

The report proves static inputs only. It does not prove a container image, TLS listener, network path, SIP registration, media relay or FusionPBX integration.

Pending gate: the Phase 1 Docker runtime validation from `docs/lemtel-control-plane/local-development.md` is still pending. It blocks every runtime, deployment, integration and pilot action.
