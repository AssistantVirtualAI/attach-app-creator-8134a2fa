import nodeAssert from "node:assert/strict";
import { collect, handle } from "./index.ts";

const eq = (a: unknown, b: unknown, m?: string) => nodeAssert.deepStrictEqual(a, b, m);
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const ACCOUNT = "8a53f376e1cba00708efaa1bba562c33";

function deps(routes: Record<string, () => Response>, env: Record<string, string> = {}) {
  const seen: string[] = [];
  return { seen, d: { env: (n: string) => ({ LEMTEL_ARBITER_STATUS_URL: "https://arbiter.example.workers.dev", ...env } as Record<string, string>)[n], now: () => Date.parse("2026-10-19T12:00:00Z"),
    fetcher: (url: string) => { seen.push(url); const r = Object.entries(routes).find(([k]) => url.startsWith(k)); return r ? Promise.resolve(r[1]()) : Promise.reject(new Error("offline")); } } };
}

Deno.test("real signals: arbiter ON, site served by DigitalOcean, pools healthy (redacted)", async () => {
  const { d } = deps({
    "https://arbiter.example.workers.dev/status": () => json({ state: "healthy", reason: "healthy", secret_field: "x" }),
    "https://lemtel.assistantvirtualai.com/lemtel-lb-ready": () => json({ writer_role: "do_writer", ip: "1.2.3.4" }),
    "https://api.cloudflare.com/": () => json({ result: [{ id: "p-do", healthy: true, enabled: true, origins: [{ address: "1.2.3.4" }] }, { id: "p-h", healthy: true, enabled: true }] }),
  }, { LEMTEL_CF_LB_READ_TOKEN: "t", LEMTEL_CF_ACCOUNT_ID: ACCOUNT, LEMTEL_CF_DO_POOL_ID: "p-do", LEMTEL_CF_HOSTINGER_POOL_ID: "p-h" });
  const s = await collect(d);
  eq(s.arbiter, { reachable: true, automaticFailover: "on", state: "healthy", reason: "healthy" });
  eq(s.routing, { servingRole: "do_writer", httpStatus: 200 });
  eq(s.loadBalancer.pools, [{ role: "do_writer", healthy: true, enabled: true }, { role: "hostinger_standby", healthy: true, enabled: true }]);
  nodeAssert.ok(!JSON.stringify(s).includes("1.2.3.4") && !JSON.stringify(s).includes("secret_field"));
});

Deno.test("arbiter disabled -> OFF; unreachable signals stay unknown (never guessed)", async () => {
  const { d } = deps({ "https://arbiter.example.workers.dev/status": () => json({ state: "disabled_or_dry_run", reason: "disabled_or_dry_run" }) });
  const s = await collect(d);
  eq(s.arbiter.automaticFailover, "off");
  eq(s.routing.servingRole, "unknown");
  eq(s.loadBalancer, { configured: false, reachable: false, pools: [] });
  const none = await collect(deps({}).d);
  eq(none.arbiter, { reachable: false, automaticFailover: "unknown", state: null, reason: null });
});

Deno.test("only platform administrators can read it", async () => {
  const admin = (isPlatform: boolean) => ({
    auth: { getUser: (t: string) => Promise.resolve(t === "ok" ? { data: { user: { id: "u1" } }, error: null } : { data: null, error: {} }) },
    from: () => { const b: Record<string, unknown> = { select: () => b, eq: () => b, maybeSingle: () => Promise.resolve({ data: isPlatform ? { user_id: "u1" } : null }) }; return b; },
  });
  const req = (t?: string) => new Request("https://x/f", { method: "POST", headers: t ? { Authorization: `Bearer ${t}` } : {} });
  eq((await handle(req(), admin(true), deps({}).d)).status, 401);
  eq((await handle(req("ok"), admin(false), deps({}).d)).status, 403);
  eq((await handle(req("ok"), admin(true), deps({}).d)).status, 200);
});
