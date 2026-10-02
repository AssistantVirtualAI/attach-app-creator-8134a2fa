# Lemtel Edge — Phase 11: Closed Local Runtime Threat Model

Scope: the future closed local validation described in the Phase 11 admission document. Phase 11 itself starts nothing; all ten Edge gates remain literal `false`.

| Threat | Required Phase 11 mitigation |
| --- | --- |
| Accidental public listener | Future admission demands loopback-only and a test must reject non-loopback binding. |
| Accidental upstream egress | Future admission demands no upstream behavior and a default-deny local network policy. |
| Media activation | Future admission requires media to remain unstarted. |
| Client route migration | Future admission fixes client behavior to unchanged. |
| Feature-gate drift | Gate state is all false and must be checked before and after future validation. |
| Secret or identity leakage | Schemas accept enums only; reports contain no raw logs or values. |
| Incomplete cleanup | Cleanup is mandatory and has its own report state. |

## Abstract future tests

- Binding check: the future runtime is observed bound to loopback only; any other binding fails the run.
- Egress check: every outgoing attempt is blocked; the report records `blocked` or `failed` only.
- Media check: no media relay process exists during the run.
- Gate check: the ten gates are read as false before and after the run.
- Cleanup check: no local container, network, volume or throwaway configuration remains.

This document contains no commands, hostnames, image names, network values, signalling values, credentials, PBX data or customer data.
