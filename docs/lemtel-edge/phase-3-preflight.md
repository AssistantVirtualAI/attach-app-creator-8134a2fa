# Lemtel Edge - Phase 3 offline preflight

This is a static local integrity gate only. Its purpose is configuration-drift detection on the committed Phase 2 package before a future runtime validation phase.

No Docker, Edge, network listener, PBX, Control Plane, app or deployment action occurs. The tool uses Node.js built-in modules only, reads a fixed list of committed inputs, writes no file and opens no socket.

## Invocation

- `node infra/lemtel-edge/preflight/edge-preflight.mjs --verify` prints `PRECHECK_PASSED` or one `PRECHECK_FAILED: <CHECK_ID>` line per failed check.
- `node infra/lemtel-edge/preflight/edge-preflight.mjs --report` prints one compact JSON object (see `preflight-report-contract.md`).
- Exit codes: 0 all checks pass, 1 a check failed, 2 invalid arguments.

## What it checks

All ten feature gates are `false`; network policy is default deny with the six Phase 2 state declarations; Kamailio keeps CORS mode 0, the internal RTPengine control reference and only the static 503 response, with no relay, registration, authentication, HTTP, DNS, database or RTPengine call; any listener is loopback and guarded; RTPengine bindings stay loopback with `final-timeout` 0; environment example values are blank and limited to the six known names; event schemas are Draft 2020-12, closed and opaque; the package holds no runtime artifact or key material.

Failure output never includes file content, values or paths.

Pending gate: the Phase 1 Docker runtime validation from `docs/lemtel-control-plane/local-development.md` is still pending. It blocks every runtime, deployment, integration and pilot action.
