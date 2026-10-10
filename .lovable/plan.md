# Prepare the full app update for Sandra and all brokers

## Goal
Ship one complete over-the-air update so phones running the old version (wrong commissions, "Dépôts 616", tasks unavailable) get the current figures and tasks. This is a full update, never a partial one, and no native iOS/Android code changes.

## Steps
1. Check that the mobile source matches the current portal code: paid/pending panels, unique funded units, all commission categories, the task list.
2. Run the mobile tests and commission/task regression tests, then build the full update bundle as the next version after 1.4.26.
3. Check the bundle: complete contents, version number, no secrets inside.
4. Publish the update through the existing app-update channel only if every check passes. Otherwise stop and report what failed.
5. Confirm the update channel now offers the new version.

## Out of scope
- The 501,86 $ paid gap stays as it is until you send Sandra's Maestro deposits export.
- Nothing is tested on a physical phone. Sandra needs to reopen the app to get the update.

## Technical details
- `apps/planipret-mobile`: `npm run ota:bundle` (build + `scripts/build-ota-bundle.mjs`), output in `ota/`.
