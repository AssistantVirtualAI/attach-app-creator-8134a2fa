# Phase 10.1 — Versioned validation history

- Change-scope checks for Phases 1, 7, 8 and 10 validate only their own accepted historical commit ranges: Phase 1 `6e512e962..224da47b7`, Phase 7 `338dfff53..0b0d74f9d`, Phase 8 `0b0d74f9d..a76ac1d48`, Phase 10 `f196aa614..49e8d39bb`. Later changes are never compared against an earlier phase.
- Current safety checks still inspect the current code: routes, imports, CORS, environment use, Compose hardening, empty examples, Dockerfile and false gates.
- The Phase 10 evaluator route is the sole permitted runtime importer of the two pure policy libraries. It must stay authenticated, non-executable and free of side-effect dependencies.
- Any second importer fails closed. The Phase 10 static-boundary service test may name the modules only in its exact import allowlist line.
- This correction does not enable Edge, PBX, deployment, client routing, device action, pilot calls or any feature gate.
- All Edge gates remain false.
- No service or endpoint was called while making this correction.
