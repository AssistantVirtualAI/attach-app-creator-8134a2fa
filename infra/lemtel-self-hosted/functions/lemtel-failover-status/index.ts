// Lemtel failover status for the portal (platform administrators only) — plan item 6.8.
// Real, redacted signals only:
//  - arbiter: the Cloudflare Worker's public /status (mode ON/OFF, state, reason tokens);
//  - routing: which node really serves the public site through the Cloudflare Load Balancer
//    (writer_role from /lemtel-lb-ready on the canonical hostname);
//  - load balancer pools: health from the Cloudflare API when a READ-ONLY token is configured.
// Never returns a hostname, IP, token, account id or raw error. Every probe is time-bounded.
import { createClient } from "npm:@supabase/supabase-js@2";

const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const TOKEN = /^[a-z][a-z0-9_]{1,80}$/;
const ARBITER_STATES = new Set(["disabled_or_dry_run", "healthy", "observation", "cycle_not_due", "blocked", "fence_requested", "fence_pending",
  "fence_verified", "promotion_command_issued", "promotion_command_dispatched", "manual_promotion_action_required", "bootstrap"]);

export type FailoverStatus = {
  checkedAt: string;
  arbiter: { reachable: boolean; automaticFailover: "on" | "off" | "unknown"; state: string | null; reason: string | null };
  routing: { servingRole: "do_writer" | "hostinger_writer" | "unknown"; httpStatus: number | null };
  loadBalancer: { configured: boolean; reachable: boolean; pools: Array<{ role: "do_writer" | "hostinger_standby" | "other"; healthy: boolean | null; enabled: boolean | null }> };
};

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export type Deps = { env: (n: string) => string | undefined; fetcher: Fetcher; now: () => number };

async function timed(fetcher: Fetcher, url: string, init: RequestInit = {}, ms = 5000): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try { return await fetcher(url, { ...init, signal: controller.signal, redirect: "manual" }); } catch { return null; } finally { clearTimeout(timer); }
}
const httpsUrl = (v: string | undefined) => { try { const u = new URL(v ?? ""); return u.protocol === "https:" && !u.username && !u.password ? u : null; } catch { return null; } };

export async function collect(d: Deps): Promise<FailoverStatus> {
  const out: FailoverStatus = {
    checkedAt: new Date(d.now()).toISOString(),
    arbiter: { reachable: false, automaticFailover: "unknown", state: null, reason: null },
    routing: { servingRole: "unknown", httpStatus: null },
    loadBalancer: { configured: false, reachable: false, pools: [] },
  };
  const arbiterUrl = httpsUrl(d.env("LEMTEL_ARBITER_STATUS_URL"));
  const siteUrl = httpsUrl(d.env("LEMTEL_PUBLIC_SITE_URL") ?? "https://lemtel.assistantvirtualai.com");
  await Promise.all([
    (async () => {
      if (!arbiterUrl) return;
      const r = await timed(d.fetcher, new URL("/status", arbiterUrl).toString());
      const body = r ? await r.json().catch(() => null) as Record<string, unknown> | null : null;
      if (!body || typeof body.state !== "string") return;
      out.arbiter.reachable = true;
      out.arbiter.state = ARBITER_STATES.has(body.state) ? body.state : "unknown";
      out.arbiter.reason = typeof body.reason === "string" && TOKEN.test(body.reason) ? body.reason : null;
      out.arbiter.automaticFailover = body.state === "disabled_or_dry_run" ? "off" : "on";
    })(),
    (async () => {
      if (!siteUrl) return;
      const r = await timed(d.fetcher, new URL("/lemtel-lb-ready", siteUrl).toString(), { headers: { "Cache-Control": "no-cache" } });
      if (!r) return;
      out.routing.httpStatus = r.status;
      const body = await r.json().catch(() => null) as Record<string, unknown> | null;
      const role = body?.writer_role;
      out.routing.servingRole = role === "do_writer" || role === "hostinger_writer" ? role : "unknown";
    })(),
    (async () => {
      const token = d.env("LEMTEL_CF_LB_READ_TOKEN"), account = d.env("LEMTEL_CF_ACCOUNT_ID");
      const doPool = d.env("LEMTEL_CF_DO_POOL_ID"), hPool = d.env("LEMTEL_CF_HOSTINGER_POOL_ID");
      if (!token || !account || !/^[0-9a-f]{32}$/.test(account)) return;
      out.loadBalancer.configured = true;
      const r = await timed(d.fetcher, `https://api.cloudflare.com/client/v4/accounts/${account}/load_balancers/pools`, { headers: { Authorization: `Bearer ${token}` } });
      const body = r?.ok ? await r.json().catch(() => null) as { result?: Array<Record<string, unknown>> } | null : null;
      if (!Array.isArray(body?.result)) return;
      out.loadBalancer.reachable = true;
      out.loadBalancer.pools = body!.result.slice(0, 8).map((p) => ({
        role: p.id === doPool ? "do_writer" : p.id === hPool ? "hostinger_standby" : "other",
        healthy: typeof p.healthy === "boolean" ? p.healthy : null,
        enabled: typeof p.enabled === "boolean" ? p.enabled : null,
      }));
    })(),
  ]);
  return out;
}

// deno-lint-ignore no-explicit-any
export async function handle(req: Request, admin: any, d: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  if (req.method !== "POST") return respond({ error: "method_not_allowed" }, 405);
  const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return respond({ error: "unauthorized" }, 401);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user?.id) return respond({ error: "unauthorized" }, 401);
  const { data: platform } = await admin.from("lemtel_platform_administrators").select("user_id").eq("user_id", data.user.id).eq("status", "active").maybeSingle();
  if (!platform?.user_id) return respond({ error: "forbidden" }, 403);
  return respond(await collect(d));
}

if (import.meta.main) {
  Deno.serve((req) => {
    const url = Deno.env.get("SUPABASE_URL") ?? "", key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!url || !key) return respond({ error: "server_not_configured" }, 503);
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return handle(req, admin, { env: (n) => Deno.env.get(n), fetcher: fetch, now: Date.now });
  });
}
