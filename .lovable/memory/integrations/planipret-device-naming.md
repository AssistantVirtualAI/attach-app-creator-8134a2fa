---
name: Planiprêt device naming (M/W)
description: NetSapiens device AORs are <ext>M (mobile) and <ext>W (web/widget) — never underscores; legacy _mobile/_web are deleted on provisioning
type: feature
---

Planiprêt NetSapiens device (AOR) naming:

- Mobile app: `<ext>M` (ex. `113M`)
- Web / widget: `<ext>W` (ex. `113W`)
- Legacy `<ext>_mobile` / `<ext>_web` are **deprecated**: Snap Mobile provisioning and the web widget mangle/reject `_` in the AOR user part.

Implementation: `supabase/functions/_shared/pp-device-ids.ts` (`mobileDeviceId`, `webDeviceId`, `legacyDeviceIds`, `isMobileDeviceId`, `isWebDeviceId`). Used by `ns-provision-broker-devices`, `ns-resolve-sip-credentials`, `pp-sync-answering-rules`, `pp-devices-expiry-guard`.

NS device names are immutable → migration = create `<ext>M`/`<ext>W`, then DELETE the legacy pair (done automatically in `ns-provision-broker-devices` once the new pair exists). Run bulk `{bulk:true, force:true}` then re-sync answering rules.
