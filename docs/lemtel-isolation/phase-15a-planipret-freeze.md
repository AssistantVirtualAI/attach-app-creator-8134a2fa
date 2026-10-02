# Lemtel — Phase 15A: Planiprêt Freeze

Status: documentation and a static read-only Git verifier only. Phase 15A changes no calling, app, portal, FusionPBX or deployment behavior.

## Authoritative Lemtel sources

- Lemtel mobile: `apps/ava-softphone-mobile/`
- Lemtel desktop: `apps/ava-softphone-desktop/`
- Lemtel portal: `src/pages/lemtel/`, `src/components/lemtel/`, `src/pages/telephony/`, `src/components/telephony/`
- Lemtel infrastructure and contracts: `infra/lemtel-*`, `services/lemtel-*`, `schemas/lemtel-*`, `docs/lemtel-*`

Historical Lemtel sources may be reviewed feature by feature, but must never be bulk-copied.

## Protected Planiprêt paths — never edit

- `apps/planipret-mobile/`
- `src/pages/planipret/`
- `src/components/planipret/`
- `src/lib/planipret/`
- `src/hooks/useMplanipretSoftphone.ts`

Also protected (case-insensitive, repository paths only): `**/planipret/**`, `**/*planipret*`, `**/PpPjsip/**`, `**/PpSipKeepAlive/**`, `**/PpVoipCall/**`.

The only exemption is the four Phase 15A files themselves, whose names contain the word for identification only: the policy, the verifier, the test and this document.

## Branch name

The `Planipret` Git branch name does not authorize any change to the Planiprêt product.

## Required check before every Lemtel phase

Run `node scripts/verify-lemtel-planipret-isolation.mjs --base=a1bd41eba` and the Phase 15A test. A failure blocks the phase.

## Escalation rule

A genuine shared-code change requires a separately written, explicitly approved compatibility phase with both products tested. Shared root dependencies or configuration may not be changed merely to satisfy a Lemtel-only phase.
