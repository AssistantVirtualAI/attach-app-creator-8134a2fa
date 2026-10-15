// pp-billing-monthly — Planiprêt monthly billing report.
// POST { action: "sync" }     admin: sync NetSapiens call queues + IVR into planipret_billing_items
// POST { action: "preview" }  admin: sync + report for the current month (no email)
// POST { action: "monthly" }  cron (X-Billing-Trigger) or admin: report for the previous month,
//                             snapshot, and email the fixed recipients once (idempotent).
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requirePlanipretAdmin } from "../_shared/require-planipret-admin.ts";
import { nsFetch } from "../_shared/planipret-ns.ts";
import { sendTemplateEmail } from "../_shared/transactional-email-templates/send-email.ts";
import { buildReport, type Item, type Profile } from "./billing.ts";

const RECIPIENTS = ["mhassoun@assistantvirtualai.com", "amassaro@assistantvirtualai.com"];
const DOMAIN = "planipret.ca";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const asList = (v: any): any[] => Array.isArray(v) ? v : Array.isArray(v?.data) ? v.data : [];

async function nsList(path: string): Promise<any[] | null> {
  const r = await nsFetch(path, {}, { functionName: "pp-billing-monthly" });
  if (!r.ok) return null;
  return asList(await r.json().catch(() => null));
}

async function syncItems(admin: any) {
  const d = encodeURIComponent(DOMAIN);
  const [queues, users] = await Promise.all([
    nsList(`/domains/${d}/callqueues?limit=1000`),
    nsList(`/domains/${d}/users?limit=1000`),
  ]);
  if (!queues || !users) return { ok: false, error: "netsapiens_unavailable" };
  const found: Array<{ kind: "queue" | "ivr"; ns_id: string; name: string | null }> = [];
  for (const q of queues) {
    const id = String(q.callqueue ?? q.queue ?? q.name ?? "").trim();
    if (id) found.push({ kind: "queue", ns_id: id, name: q.description ?? q["callqueue-description"] ?? q.name ?? id });
  }
  for (const u of users) {
    const svc = String(u["service-code"] ?? "").toLowerCase();
    if (!/system-aa|auto-?attendant/.test(svc)) continue;
    const id = String(u.user ?? "").trim();
    const nm = `${u["name-first-name"] ?? ""} ${u["name-last-name"] ?? ""}`.trim();
    if (id) found.push({ kind: "ivr", ns_id: id, name: nm || id });
  }

  const { data: existing } = await admin.from("planipret_billing_items").select("id,kind,ns_id,removed_at").eq("ns_domain", DOMAIN);
  const firstSync = !existing?.length;
  const now = new Date().toISOString();
  const key = (k: string, id: string) => `${k}|${id}`;
  const seen = new Set(found.map((f) => key(f.kind, f.ns_id)));
  const known = new Map((existing ?? []).map((e: any) => [key(e.kind, e.ns_id), e]));

  const inserts = found.filter((f) => !known.has(key(f.kind, f.ns_id))).map((f) => ({
    ...f, ns_domain: DOMAIN, last_seen_at: now,
    // On the very first sync, everything already in NetSapiens is pre-existing (no activation fee).
    first_seen_at: firstSync ? "2000-01-01T00:00:00Z" : now,
  }));
  if (inserts.length) await admin.from("planipret_billing_items").insert(inserts);
  for (const f of found) {
    const e: any = known.get(key(f.kind, f.ns_id));
    if (e) await admin.from("planipret_billing_items").update({ name: f.name, last_seen_at: now, removed_at: null }).eq("id", e.id);
  }
  const gone = (existing ?? []).filter((e: any) => !e.removed_at && !seen.has(key(e.kind, e.ns_id))).map((e: any) => e.id);
  if (gone.length) await admin.from("planipret_billing_items").update({ removed_at: now }).in("id", gone);
  return { ok: true, queues: found.filter((f) => f.kind === "queue").length, ivrs: found.filter((f) => f.kind === "ivr").length, added: firstSync ? 0 : inserts.length, removed: gone.length };
}

async function report(admin: any, start: Date, end: Date) {
  const [{ data: profiles }, { data: items }] = await Promise.all([
    admin.from("planipret_profiles").select("created_at,full_name,email,ns_domain,mobile_app_enabled,voice_agent_enabled,ava_chat_enabled").limit(5000),
    admin.from("planipret_billing_items").select("kind,name,first_seen_at,removed_at").eq("ns_domain", DOMAIN),
  ]);
  return buildReport((profiles ?? []) as Profile[], (items ?? []) as Item[], start, end);
}

// Month boundaries in UTC; the cron runs the 1st at 11:00 UTC (≈07:00 Toronto).
const monthStart = (y: number, m: number) => new Date(Date.UTC(y, m, 1));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const trig = req.headers.get("X-Billing-Trigger")?.trim() ?? "";
  let isCron = false;
  if (trig.length >= 32 && trig.length <= 128) {
    const { data } = await admin.from("planipret_billing_trigger").select("token").eq("id", 1).maybeSingle();
    isCron = !!data?.token && data.token === trig;
  }
  if (!isCron) {
    const deny = await requirePlanipretAdmin(req);
    if (deny) return deny;
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "");
  if (!["sync", "preview", "monthly"].includes(action)) return json({ error: "invalid_action" }, 400);
  if (isCron && action !== "monthly") return json({ error: "forbidden" }, 403);

  const sync = await syncItems(admin);
  if (action === "sync") return json(sync, sync.ok ? 200 : 502);

  const now = new Date();
  if (action === "preview") {
    const start = monthStart(now.getUTCFullYear(), now.getUTCMonth());
    const end = monthStart(now.getUTCFullYear(), now.getUTCMonth() + 1);
    return json({ sync, report: await report(admin, start, end) });
  }

  // monthly: previous month
  const start = monthStart(now.getUTCFullYear(), now.getUTCMonth() - 1);
  const end = monthStart(now.getUTCFullYear(), now.getUTCMonth());
  const monthKey = start.toISOString().slice(0, 10);
  const { data: snap } = await admin.from("planipret_billing_snapshots").select("data,emailed_at").eq("month", monthKey).maybeSingle();
  const rep = snap?.data && Object.keys(snap.data).length ? snap.data : await report(admin, start, end);
  if (!snap) await admin.from("planipret_billing_snapshots").insert({ month: monthKey, data: rep });
  if (snap?.emailed_at) return json({ month: monthKey, already_sent: true });

  const results: Record<string, string> = {};
  let allOk = true;
  for (const to of RECIPIENTS) {
    try {
      const r = await sendTemplateEmail("planipret-monthly-billing", to, {
        templateData: { report: rep },
        idempotencyKey: `billing-${monthKey}-${to}`,
      });
      results[to] = r.sent ? "sent" : r.reason;
    } catch (e) {
      allOk = false;
      results[to] = (e as any)?.code ?? "error";
    }
  }
  if (allOk) await admin.from("planipret_billing_snapshots").update({ emailed_at: new Date().toISOString() }).eq("month", monthKey);
  console.log(`[pp-billing-monthly] month=${monthKey} results=${JSON.stringify(Object.values(results))}`);
  return json({ month: monthKey, sync, results });
});
