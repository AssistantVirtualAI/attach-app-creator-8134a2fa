import assert from "node:assert/strict";
import { handler, redactedTrafficTrend, trafficTrend, validateBody } from "./index.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const now = Date.UTC(2026, 9, 15, 12, 0, 30);
const row = (at: string, role = "do_writer") => ({ node_role: role, observed_at: at, period_seconds: 60, rx_bytes: 10, tx_bytes: 20, tcp_established: 3, collector_state: "collecting" });
Deno.test("traffic action has an exact read-only platform body", () => {
  assert.deepEqual(validateBody({ action: "get_traffic_trend" }), { action: "get_traffic_trend" });
  assert.deepEqual(validateBody({ action: "get_traffic_trend", organizationId: "ignored" }), { error: "invalid_body", status: 400 });
});
Deno.test("24h traffic buckets sum measured deltas, take latest TCP gauge, redact and deduplicate", () => {
  const trend = redactedTrafficTrend([
    { ...row("2026-10-15T11:56:00Z"), secret: "must-not-leave", ip: "must-not-leave" },
    row("2026-10-15T11:57:00Z"), { ...row("2026-10-15T11:58:00Z"), tcp_established: 9 },
    row("2026-10-15T12:00:00Z"), row("2026-10-15T12:00:00Z"),
    row("2026-10-15T11:00:00Z", "hostinger_standby"),
    row("2026-10-14T12:00:00Z"), row("2026-10-15T12:01:00Z"), row("2026-10-15T12:00:00Z", "invalid"),
    { ...row("2026-10-15T11:55:00Z"), rx_bytes: -1 }, { ...row("2026-10-15T11:55:00Z"), period_seconds: 0 },
  ], now);
  assert.equal(Date.parse(trend.windowEnd) - Date.parse(trend.windowStart), 86_400_000);
  assert.equal(trend.roles[0].collectorState, "collecting"); assert.equal(trend.roles[1].collectorState, "pending");
  assert.deepEqual(trend.roles[0].samples[0], { observedAt: "2026-10-15T11:55:00.000Z", periodSeconds: 180, rxBytes: 30, txBytes: 60, tcpEstablished: 9 });
  assert.equal(trend.roles[0].samples[1].rxBytes, 10);
  assert.equal(trend.roles[0].latest?.periodSeconds, 60);
  assert.ok(!JSON.stringify(trend).includes("must-not-leave"));
  assert.equal(redactedTrafficTrend([], now).roles.every((entry) => entry.collectorState === "pending" && !entry.latest && entry.samples.length === 0), true);
});
Deno.test("traffic pagination reads the whole bounded 24h window without client identifiers", async () => {
  const requests: Request[] = [];
  const client = createClient("https://local.invalid", "synthetic-service-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
    const req = new Request(input, init); requests.push(req);
    const offset = Number(new URL(req.url).searchParams.get("offset") ?? 0);
    const data = Array.from({ length: offset < 2000 ? 1000 : 880 }, (_, i) => row(new Date(now - 60_000 * (1 + Math.floor((offset + i) / 2))).toISOString(), (offset + i) % 2 ? "hostinger_standby" : "do_writer"));
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
  } } });
  const trend = await trafficTrend(client, now);
  assert.equal(requests.length, 3);
  for (const req of requests) {
    assert.equal(req.method, "GET");
    assert.equal(new URL(req.url).searchParams.get("select"), "node_role,observed_at,period_seconds,rx_bytes,tx_bytes,tcp_established,collector_state");
    assert.ok(new URL(req.url).searchParams.getAll("observed_at").length === 2);
  }
  assert.ok("roles" in trend);
});
Deno.test("authoritative handler refuses non-platform actors and traffic reads make no writes", async () => {
  const originalFetch = globalThis.fetch;
  const savedUrl = Deno.env.get("SUPABASE_URL"), savedKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.set("SUPABASE_URL", "https://local.invalid"); Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
  try {
    for (const platform of [false, true]) {
      const requests: Request[] = [];
      globalThis.fetch = async (input, init) => {
        const req = new Request(input, init); requests.push(req);
        const path = new URL(req.url).pathname;
        const data = path === "/auth/v1/user" ? { id: "11111111-1111-4111-8111-111111111111" }
          : path === "/rest/v1/lemtel_platform_administrators" ? (platform ? { user_id: "11111111-1111-4111-8111-111111111111" } : null)
          : path === "/rest/v1/lemtel_traffic_samples" ? [] : undefined;
        assert.notEqual(data, undefined);
        return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
      };
      const response = await handler(new Request("https://local.invalid/admin", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer synthetic-user-token" }, body: '{"action":"get_traffic_trend"}' }));
      assert.equal(response.status, platform ? 200 : 403);
      assert.equal(requests.some((req) => new URL(req.url).pathname.endsWith("lemtel_traffic_samples")), platform);
      assert.ok(requests.every((req) => req.method === "GET"));
      assert.equal(response.headers.has("Access-Control-Allow-Origin"), false);
      if (platform) { const result = await response.json(); assert.equal(result.roles.length, 2); }
    }
    const denied = await handler(new Request("https://local.invalid/admin", { method: "POST", body: '{"action":"get_traffic_trend"}' }));
    assert.equal(denied.status, 401);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of [["SUPABASE_URL", savedUrl], ["SUPABASE_SERVICE_ROLE_KEY", savedKey]]) {
      if (value === undefined) Deno.env.delete(name!); else Deno.env.set(name!, value);
    }
  }
});
Deno.test("traffic database failure is unavailable, never disguised as zero data", async () => {
  const client = createClient("https://local.invalid", "synthetic", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async () => new Response('{"message":"hidden","code":"synthetic"}', { status: 503, headers: { "Content-Type": "application/json" } }) } });
  assert.deepEqual(await trafficTrend(client, now), { error: "traffic_trend_unavailable", status: 503 });
});

Deno.test("traffic database timeout is unavailable and never leaves the request pending", async () => {
  const client = createClient("https://local.invalid", "synthetic", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (_input, init) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }) },
  });
  assert.deepEqual(await trafficTrend(client, now, 1), { error: "traffic_trend_unavailable", status: 503 });
});
