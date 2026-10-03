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

## Phase 15A.1 — frozen scope and permanent guard

- Phase 15A's original implementation is attested only over `a1bd41eba..87b6b8029` (`PHASE15A_END`), which must contain exactly the four Phase 15A files.
- The verifier additionally scans all later committed history (`87b6b8029..HEAD`, failure `PLANIPRET_PATH_CHANGED`) and the current staged, unstaged and untracked working tree (failure `PLANIPRET_WORKTREE_CHANGED`) for Planiprêt-protected paths.
- Later Lemtel phases can add non-Planiprêt files without invalidating historical Phase 15A.
- Every future phase still must execute its own strict phase-scope verifier **and** this permanent Planiprêt guard.

## Escalation rule

A genuine shared-code change requires a separately written, explicitly approved compatibility phase with both products tested. Shared root dependencies or configuration may not be changed merely to satisfy a Lemtel-only phase.

## Historical compatibility baseline — Phase 15C

- The original Phase 15A range `a1bd41eba..87b6b8029` remains immutable.
- Seven Planiprêt files were already changed in the separately audited interval `87b6b8029..2d933df2f`.
- Their exact paths are frozen as a one-time compatibility record (see `phase-15c-historical-compatibility-baseline.md`).
- The permanent "never modify Planiprêt" guard starts strictly after `2d933df2f`.
- No Planiprêt source was changed by Phase 15C.

## Phase 15D — shared repository, per-phase scope guard

- Lemtel and Planiprêt share one Lovable project, one GitHub repository and the synchronized `Planipret` branch. Neither the shared repository nor the branch name authorizes a Lemtel prompt to modify Planiprêt.
- The historical guards are immutable: `BASE = a1bd41eba`, `PHASE15A_END = 87b6b8029`, `PLANIPRET_COMPATIBILITY_END = 2d933df2f`, the four Phase 15A files and the seven Phase 15C paths.
- No-argument mode (`node scripts/verify-lemtel-planipret-isolation.mjs`) checks the frozen 15A/15C ranges, the policy, the verifier's own read-only capabilities and the current working tree: any staged, unstaged or untracked Planiprêt path fails with `PLANIPRET_WORKTREE_CHANGED`. It no longer fails on Planiprêt commits made by the other product before the current Lemtel phase.
- `--scope=<commit>` is mandatory before and after every future Lemtel phase, with the phase's starting commit. It must be a commit and an ancestor of `HEAD` (`SCOPE_MISSING`, `SCOPE_NOT_ANCESTOR`). Any protected path committed in `scope..HEAD`, except the Phase 15 technical files in `ALLOWED`, fails with `PLANIPRET_SCOPE_CHANGED`.
- Usage: `LEMTEL_ISOLATION_USAGE: [--base=a1bd41eba] [--scope=<commit>]`. `--base` and `--scope` are never combined.
- Planiprêt commits that precede a Lemtel phase's scope base are not approved, examined or validated by Lemtel; they are simply outside that phase's range. There is no permanent Planiprêt exception.
