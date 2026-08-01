# Maestro call posting rules (Scott's 4 rules)

## Current state (verified)

- `src/hooks/useMplanipretSoftphone.ts:911` posts `maestroTelecom.createCall(...)` **only** on the PBX fallback path (`callViaPBX`). Calls placed over WebRTC (`ppSipProvider.call`) never post.
- Inbound calls never post to Maestro from the frontend at all.
- `maestroTelecom.createCall` → `POST /users/{me}/calls` via the `maestro-telecom` edge function (`src/lib/planipret/maestroTelecom.ts:44`).
- `maestroTelecom.lookupByPhone` (`POST /users/{me}/lookup-by-phone`) already exists and is used server-side in `maestro-cdr` to resolve a number to a client/broker.
- `apps/planipret-mobile/src/**` is a byte-identical mirror of the same files; every change must be applied twice.

## What to build

A small module `src/lib/planipret/maestroCallPosting.ts` (+ mirror) that owns the 4 rules:

- `isBrokerVoipNumber(number)` — true when the remote party is internal: bare extension (3–5 digits), or the number resolves to a broker via a cached broker list (`maestro-actions` `list_brokers`) / `lookup-by-phone` returning a broker match. Cached in memory for the session, fail-safe defaults documented below.
- `postOutboundCall({ providerCallId, number })` — always posts (rules 1 and 2; both client and broker VoIP destinations).
- `postInboundCall({ providerCallId, number })` — posts only when the caller is **not** a broker VoIP number (rules 3 and 4).
- Deduplication by `provider_call_id` in a module-level `Set`, so re-renders, push-then-INVITE, and the REST/SIP dual path can't double-post. (Backend is idempotent anyway, per Scott.)
- All posts stay fire-and-forget through the existing `maestroLog` wrapper: never block or break the call UI.

## Wiring in `useMplanipretSoftphone.ts`

- `callViaPBX`: replace the inline `createCall` with `postOutboundCall` (keeps behaviour, adds dedup).
- WebRTC outbound: post from the existing snapshot effect when `snap.direction === "out"` and state becomes `ringing-out`, using the SIP `callId` as `provider_call_id`.
- Inbound: in the same effect, when `snap.direction === "in"` and state becomes `ringing-in`, call `postInboundCall` — which self-skips for broker VoIP callers. Push-only ringing (`pushRing`, no INVITE yet) posts with the push `callId` and the push caller number.
- Existing `updateCall(..., "ended")` calls stay, but are only sent for calls we actually posted.

## Fail-safe behaviour

If broker classification can't be resolved (network error, no Maestro link), inbound posting is **skipped** rather than posted — duplicates are the failure Scott explicitly wants avoided, and the CDR-driven server pipeline (`ns-webhook-receiver` → `maestro-sync-call`) still syncs the call afterwards. Outbound always posts, as it is unconditional in the rules.

## Reply to Scott

I'll draft a short reply confirming the 4 rules are implemented on the frontend, how broker-vs-client classification is done, and noting we rely on the idempotent `POST /calls` for the multi-device inbound case.
