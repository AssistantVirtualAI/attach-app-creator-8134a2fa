# Lemtel Edge to Control Plane - future event contract v1

Future contract only. No HTTP client, server or callback is implemented in Phase 2. This is a standalone future Control Plane contract and does not change the read-only preview.

## Headers

- `X-Lemtel-Edge-Version: v1`
- `X-Lemtel-Edge-Timestamp`: UTC RFC 3339
- `X-Lemtel-Edge-Nonce`: UUID
- `X-Lemtel-Edge-Signature`: `v1=<hex HMAC-SHA256>`

## Canonical signing input

```text
version + "\n" + timestamp + "\n" + nonce + "\n" + sha256(raw_body)
```

## Future Control Plane validation

- strict version match
- bounded timestamp skew
- nonce replay prevention
- constant-time signature comparison
- tenant and device authorization

The HMAC secret is neither generated, stored, exposed, transmitted, nor used in Phase 2.

## Body

The body follows `schemas/lemtel-edge/edge-event-envelope-v1.schema.json`, with payloads `registration-health-v1` or `invite-push-v1`. Every object rejects additional properties.
