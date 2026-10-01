# Lemtel Edge - Phase 5 provisioning state machine (future only)

| From | Event | To |
|---|---|---|
| requested | future Control Plane authorization allow | queued |
| queued | future adapter confirms | applied |
| queued | future adapter refuses | rejected |
| any active or queued state | revocation | revoked (takes priority) |
| rejected | future controlled retry, never client-triggered | requested |

- The observed state begins `not_connected`; `current` is a future value only.
- Revocation takes priority over any active or queued state.
- Retry is future controlled and never client-triggered.
- No automatic raw-PBX reconciliation happens in Phase 5.
- All actions require a future Control Plane authorization decision and a future Edge/device capability reference.

Pending gate: the Phase 1 Docker runtime validation from `docs/lemtel-control-plane/local-development.md` is still pending. It blocks every runtime, deployment, integration, gate and pilot action.
