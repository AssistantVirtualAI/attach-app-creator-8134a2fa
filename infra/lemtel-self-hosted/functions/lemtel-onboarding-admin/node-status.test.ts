import assert from "node:assert/strict";
import { handler, nodeStatus, redactedNodeStatus, validateBody } from "./index.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const now = Date.UTC(2026, 9, 15, 12, 0, 30);
const row = (node_role = "do_writer", observed_at = "2026-10-15T12:00:00Z") => ({
  node_role, observed_at, agent_state: "healthy", runtime_state: "ready", replication_state: "streaming", storage_state: "synced",
});
Deno.test("node status action has an exact platform-admin body", () => {
  assert.deepEqual(validateBody({ action: "get_node_status" }), { action: "get_node_status" });
  assert.deepEqual(validateBody({ action: "get_node_status", ignored: true }), { error: "invalid_body", status: 400 });
});
Deno.test("node status projection has two fixed roles, redacts extras and makes stale rows unknown", () => {
  const status = redactedNodeStatus([
    { ...row(), hostname: "must-not-leave", metric: 99, error: "must-not-leave" },
    row("hostinger_standby", "2026-10-15T11:56:00Z"), row("invalid"), { ...row(), observed_at: "bad" },
  ], now);
  assert.equal(status.telemetry, "live"); assert.equal(status.roles.length, 2);
  assert.deepEqual(status.roles[0], { nodeRole: "do_writer", observedAt: "2026-10-15T12:00:00.000Z", agentState: "healthy", runtimeState: "ready", replicationState: "streaming", storageState: "synced" });
  assert.deepEqual(status.roles[1], { nodeRole: "hostinger_standby", observedAt: "2026-10-15T11:56:00.000Z", agentState: "unknown", runtimeState: "unknown", replicationState: "unknown", storageState: "unknown" });
  assert.ok(!JSON.stringify(status).includes("must-not-leave"));
  assert.deepEqual(redactedNodeStatus([], now).roles.map((entry) => entry.agentState), ["unknown", "unknown"]);
});
Deno.test("bounded current-state read has an abort signal and never reads history", async () => {
  const requests: Request[] = [];
  const client = createClient("https://local.invalid", "synthetic-service-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
    const req = new Request(input, init); requests.push(req);
    return new Response(JSON.stringify([row(), row("hostinger_standby")]), { headers: { "Content-Type": "application/json" } });
  } } });
  const result = await nodeStatus(client, now);
  assert.ok("roles" in result); assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].url).pathname, "/rest/v1/lemtel_node_status_current");
  assert.equal(new URL(requests[0].url).searchParams.get("select"), "node_role,observed_at,agent_state,runtime_state,replication_state,storage_state");
  assert.equal(requests[0].method, "GET");
  assert.equal(new URL(requests[0].url).searchParams.get("limit"), "2");
});
Deno.test("platform action denies non-admins and is read-only from the browser perspective", async () => {
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
          : path === "/rest/v1/lemtel_node_status_current" ? [row()] : undefined;
        assert.notEqual(data, undefined);
        return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
      };
      const response = await handler(new Request("https://local.invalid/admin", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer synthetic-user-token" }, body: '{"action":"get_node_status"}' }));
      assert.equal(response.status, platform ? 200 : 403);
      assert.equal(requests.some((req) => new URL(req.url).pathname.endsWith("lemtel_node_status_current")), platform);
      assert.equal(response.headers.has("Access-Control-Allow-Origin"), false);
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of [["SUPABASE_URL", savedUrl], ["SUPABASE_SERVICE_ROLE_KEY", savedKey]]) {
      if (value === undefined) Deno.env.delete(name!); else Deno.env.set(name!, value);
    }
  }
});
Deno.test("node status database failure and timeout are unavailable rather than invented", async () => {
  const failed = createClient("https://local.invalid", "synthetic", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async () => new Response("{}", { status: 503, headers: { "Content-Type": "application/json" } }) } });
  assert.deepEqual(await nodeStatus(failed, now), { error: "node_status_unavailable", status: 503 });
  const stalled = createClient("https://local.invalid", "synthetic", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (_input, init) => await new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true })) } });
  assert.deepEqual(await nodeStatus(stalled, now, 1), { error: "node_status_unavailable", status: 503 });
});
