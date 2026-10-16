/**
 * pp-ns-call-trace — admin-only, READ-ONLY SIP trace summary for one call.
 * Returns only SIP methods/status codes, timings, transport and masked hosts.
 * Never returns numbers, names, SDP, auth headers or raw provider bodies.
 */
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { nsFetch, requirePlanipretBroker, jsonResponse } from "../_shared/planipret-ns.ts";

const maskHost = (h: string) =>
  h.replace(/\b(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}\b/g, "$1.$2.x.x");

function summarize(text: string) {
  const lines = text.split(/\r?\n/);
  const events: Array<Record<string, string>> = [];
  let cur: Record<string, string> | null = null;
  for (const raw of lines) {
    const l = raw.trim();
    const start = l.match(/^(INVITE|ACK|BYE|CANCEL|UPDATE|PRACK|OPTIONS|INFO|REFER|NOTIFY|REGISTER)\s+sip:\S+\s+SIP\/2\.0/i)
      ?? l.match(/^SIP\/2\.0\s+(\d{3})\b(.*)$/);
    if (start) {
      if (cur) events.push(cur);
      cur = { msg: /^SIP/.test(l) ? `${start[1]}${start[2] ? " " + start[2].trim().slice(0, 30) : ""}` : start[1].toUpperCase() };
      const ts = lines[Math.max(0, lines.indexOf(raw) - 1)]?.match(/\d{2}:\d{2}:\d{2}(\.\d+)?/);
      if (ts) cur.time = ts[0];
      continue;
    }
    if (!cur) continue;
    const ts = l.match(/^\S*\s*(\d{4}-\d{2}-\d{2}[ T])?(\d{2}:\d{2}:\d{2}(\.\d+)?)/);
    if (ts && !cur.time) cur.time = ts[2];
    const h = l.match(/^(Via|Contact|CSeq|Reason|Record-Route|Route|Session-Expires|X-[\w-]*Cause)\s*:\s*(.*)$/i);
    if (h) {
      const key = h[1].toLowerCase();
      if (cur[key]) continue;
      let v = h[2];
      if (key === "contact") v = v.replace(/sip:[^@]*@/, "sip:***@");
      cur[key] = maskHost(v).slice(0, 160);
    }
  }
  if (cur) events.push(cur);
  return events.slice(0, 200);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = await requirePlanipretBroker(req);
  if (auth instanceof Response) return auth;
  const { ctx, supabase } = auth;
  const { data: isAdmin } = await supabase.rpc("is_planipret_admin", { _user_id: ctx.userId });
  if (isAdmin !== true) return jsonResponse({ ok: false, error: "forbidden_admin_only" }, 403);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const id = String(body?.call_row_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonResponse({ ok: false, error: "invalid_call_row_id" }, 400);

  const { data: row } = await supabase.from("planipret_phone_calls")
    .select("extension, ns_domain, direction, duration_seconds, started_at, ns_call_id, ns_callid, ns_orig_callid, ns_term_callid, ns_cdr_id")
    .eq("id", id).maybeSingle();
  if (!row?.ns_domain) return jsonResponse({ ok: false, error: "call_not_found" }, 404);

  const dom = encodeURIComponent(row.ns_domain);
  const start = new Date(row.started_at);
  const ids = [...new Set([row.ns_orig_callid, row.ns_term_callid, row.ns_callid, row.ns_call_id].filter(Boolean).map(String))];
  const attempts: Array<{ path: string; status: number }> = [];
  const traces: Array<{ which: number; events: unknown[] }> = [];
  const fmt = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19);
  const q = `start_time=${encodeURIComponent(fmt(new Date(start.getTime() - 120_000)))}&end_time=${encodeURIComponent(fmt(new Date(start.getTime() + ((row.duration_seconds ?? 0) + 180) * 1000)))}`;
  const candidates: string[] = [];
  if (row.ns_cdr_id) candidates.push(`/domains/${dom}/cdrs/${encodeURIComponent(row.ns_cdr_id)}/sipflow?type=csv`);
  if (ids.length) {
    for (const srv of ["core1.cluster1.ucstack.io", "core2.cluster1.ucstack.io"]) {
      candidates.push(`/sipflow?type=csv&servers=${srv}&callids=${encodeURIComponent(ids.join(","))}&${q}`);
    }
  }
  for (const p of candidates) {
    try {
      const r = await nsFetch(p, { method: "GET" }, { functionName: "pp-ns-call-trace" });
      let t = await r.text();
      attempts.push({ path: p.split("?")[0].replace(dom, "dom").replace(/cdrs\/[^/]+/, "cdrs/id"), status: r.status });
      if (!r.ok) continue;
      try {
        const j = JSON.parse(t);
        const b = typeof j === "string" ? j : (j?.data ?? j?.base64 ?? j?.file ?? j?.content ?? "");
        if (typeof b === "string" && b && !/SIP\/2\.0/.test(b)) { try { t = atob(b); } catch { t = b; } }
        else if (typeof b === "string" && b) t = b;
      } catch { /* raw */ }
      t = t.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/""/g, "\"");
      if (/SIP\/2\.0/.test(t)) { traces.push({ which: 0, events: summarize(t) }); break; }
      attempts.push({ path: "no_sip_in_body", status: t.length });
    } catch { attempts.push({ path: "error", status: 0 }); }
  }
  return jsonResponse({
    ok: true, extension: row.extension, direction: row.direction, duration: row.duration_seconds,
    started_at: row.started_at, id_count: ids.length, attempts, traces,
  });
});
