# Lemtel Mobile — 5 Bug Fixes

## 1. Hangup freeze (`src/hooks/useSoftphoneVerto.ts`)
In `hangup()`, after `d.hangup()` / `hangupAll()`:
- Set `callState='ended'`, clear `isMuted`, `isOnHold`, `activeCallNumber`, timer.
- After 800ms → `callState='idle'`.
- Add 5s safety watchdog: if still `active`/`ringing` after hangup call, force `idle`.

## 2 & 3. `normalizePhone` breaks extensions & star codes
In `useSoftphoneVerto.ts` `call()`:
```ts
const isExternal = /^\+/.test(number) || /^\d{10,}$/.test(number.replace(/\D/g,''));
const normalized = isExternal ? (normalizePhone(number) || number) : number;
```
Verify `src/lib/dialNumber.ts` `sanitize` keeps `*` and `#` and passes them through untouched to `sp.call()`.

## 4. `repair-all-extensions-verto` overwrites fields (`supabase/functions/fusionpbx-proxy/index.ts`)
- Fetch full current extension record first.
- Spread all fields, override only `dial_string`, `call_timeout:"35"`, `hangup_after_bridge:"true"`, `user_record:"all"`.
- Add single-extension variant `repair-verto-extension-routing` doing the same.
- Redeploy `fusionpbx-proxy`.

## 5. Verto clients not visible (`AdminRegistrations.tsx` + edge function)
- Add `get-verto-clients` action in `fusionpbx-proxy` calling FusionPBX `verto_clients` endpoint.
- New "Verto Clients" tab in `AdminRegistrations.tsx`: extension, IP, connected since, platform.
- Add note in SIP panel: "Android Verto connections appear in the Verto Clients tab above."

## 6. iOS hangup race (`ios/App/App/Plugins/CapacitorSip/CapacitorSip.swift`)
After `pjsua_call_hangup`:
- Reset `currentCallId = pjsua_call_id(PJSUA_INVALID_ID.rawValue)`.
- Emit `callEnded {reason:'local_hangup'}` and `callStateChanged {state:'ended'}`.

## Post-change
User runs: `git pull origin Planipret` + `npx cap sync android ios` + rebuild.
