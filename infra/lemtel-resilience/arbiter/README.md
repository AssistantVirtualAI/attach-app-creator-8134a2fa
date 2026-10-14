# Lemtel failover arbiter — Cloudflare Workers bootstrap

This Worker is intentionally independent of DigitalOcean and Hostinger, but it is **not an active failover controller**. Its bootstrap response is a redacted, no-store `deny` state. The scheduled tick contains no I/O and cannot invoke provider APIs, promote PostgreSQL, start Hostinger, mutate Cloudflare Load Balancing or expose credentials.

The next implementation phase adds only read-only observations and signed incident receipts. Decision mode stays disabled until every prerequisite named in `contract.json` is independently attested and controlled drills succeed.
