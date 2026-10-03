# Lemtel — Phase 15C: One-Time Historical Planiprêt Compatibility Baseline

## Purpose
Repair the Lemtel isolation verifier so later Lemtel-only phases are not blocked by Planiprêt changes that were committed before the Phase 18B-2 baseline.

## Non-goal
This phase changes no Planiprêt source and does not validate Planiprêt business behavior. It validates path boundaries only.

## Boundaries
- Phase 15A end: `87b6b8029`
- Compatibility cutoff: `2d933df2f`

## Exact allowed historical paths (interval `87b6b8029..2d933df2f`)
- `apps/planipret-mobile/src/pages/planipret/PlanipretMobile.tsx`
- `apps/planipret-mobile/src/pages/planipret/mobile/MCalls.tsx`
- `apps/planipret-mobile/src/pages/planipret/mobile/MContacts.tsx`
- `src/pages/planipret/PlanipretMobile.tsx`
- `src/pages/planipret/broker/PBMarketing.tsx`
- `src/pages/planipret/mobile/MCalls.tsx`
- `src/pages/planipret/mobile/MContacts.tsx`

## Audited historical commits
- `be745b4d164f75e50c57b1d0596f0500cdf51457`
- `927f5852796d5dce99452130d7fbf11506b19ea5`
- `b78a6e4cede7659bdb5c2c3332b6319bcf936880`
- `94a214c34e051cc6b7bf567207144af1d48228d2`
- `1b8de84be5c1d6d25625eede43ade19c9910e8d0`
- `6ff7adb57e88d0afe24bf65f70ad0314f005ca3a`
- `d8eba749f5855a71831cb216a452a0777339bb6e`

## Current guard rules
- The historical interval `87b6b8029..2d933df2f` is immutable; any deviation from the exact seven paths fails with `PLANIPRET_COMPATIBILITY_SCOPE_EXACT`.
- The working-tree guard fails on any staged, unstaged or untracked Planiprêt path with `PLANIPRET_WORKTREE_CHANGED`.
- A per-phase Lemtel guard `--scope=<commit>` fails on any Planiprêt path in `scope..HEAD` with `PLANIPRET_SCOPE_CHANGED`.
- Planiprêt changes committed outside and before that scope are neither a Lemtel approval nor a Lemtel validation.
- There is no permanent exception.

## What this is not
This is not a source merge, copy, rollback, or approval for any future Planiprêt work.

## Rollback
Revert this phase only if the existing Planiprêt source is separately reviewed and the compatibility baseline must be replaced by a newly approved boundary.

## Phase 15D update
The seven-path interval `87b6b8029..2d933df2f` stays frozen and exact. Protection after it is provided by the working-tree guard (`PLANIPRET_WORKTREE_CHANGED`, always on) and the per-phase `--scope=<commit>` guard (`PLANIPRET_SCOPE_CHANGED` for any Planiprêt path inside a Lemtel phase's own `scope..HEAD`). Planiprêt changes committed after `2d933df2f` by Planiprêt work are not approved, compatible or examined by this baseline.
