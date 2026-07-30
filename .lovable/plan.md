## Goal
Consume Scott's 4 new Maestro endpoints for mobile:
```text
GET /users/{id}/clients
GET /users/{id}/clients/{client-id}/profile
GET /users/{id}/brokers
GET /users/{id}/brokers/{broker-id}/profile
```
`{id}` = the broker's numeric Maestro telecom user id (already resolved today via `resolveBrokerId` / `planipret_profiles.maestro_broker_id`).

## Backend (`supabase/functions/maestro-actions/index.ts`)
Add 4 actions, all routed through `maestroTelecomFetch` (machine key + `machine=1`, retries/timeouts already handled), never raw fetch:
- `list_clients` → `/users/{id}/clients` (optional `search`, `limit`)
- `client_profile` → `/users/{id}/clients/{clientId}/profile`
- `list_brokers` → `/users/{id}/brokers`
- `broker_profile` → `/users/{id}/brokers/{brokerId}/profile`

Rules:
- Resolve `{id}` server-side from the caller's JWT → `planipret_profiles.maestro_broker_id`; allow an explicit `payload.user_id` only for admins.
- Normalize each response into the shared contact shape already used by the dialer (`id, first_name, last_name, display_name, email, phone/cell_phone/work_phone, company, maestro_client_id`), tolerating array vs `{clients|brokers|data}` envelopes.
- On non-OK, return the provider status + body (no bare 500).

## Mobile (`apps/planipret-mobile`)
- `src/lib/ppContactsCache.ts`: add cache actions `maestro_clients` and `maestro_brokers` (same TTL + localStorage persistence + inflight dedup), fetched via the new actions; add them to `prefetchPpContacts`.
- Contacts/Directory screen: show sections "Mes clients" (Maestro clients) and "Courtiers" (Maestro brokers) alongside the existing NS directory, deduped by phone/email.
- Contact detail: lazy-load the `*/profile` endpoint on open (cached per id) to show the extra profile fields; keep existing SMS/Call/Email actions.

## Staging validation
- Call each of the 4 actions with `curl_edge_functions` for one known broker id, log the raw status/body shape, and confirm field names before finalizing normalization (Scott's exact payload shape is unverified — the mapping is adjusted after this probe).
- Report results back to Scott.

## Notes
- No DB migration needed; nothing is persisted unless you want a cache table later.
- Existing `list_contacts` stays as-is (fallback), so nothing regresses if the new endpoints are not yet live on prod.
