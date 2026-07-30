// TEMPORARY DID repair runner (read-compare-write) — deleted after use.
import { DID_MAP } from "./mapping.ts";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
const KEY = Deno.env.get("NS_API_KEY") ?? "";
const BASE = Deno.env.get("NS_API_BASE_URL") ?? "https://voice.ava-telecom.ca/ns-api/v2";
const DOM = Deno.env.get("NS_DEFAULT_DOMAIN") ?? "planipret.ca";

async function ns(path: string, init: RequestInit = {}) {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json", "Content-Type": "application/json", Connection: "close", ...(init.headers ?? {}) },
  });
  const t = await r.text();
  let d: any = null; try { d = t ? JSON.parse(t) : null; } catch { d = t; }
  return { ok: r.ok, status: r.status, data: d };
}
const dest = (x: any) => {
  const o = Array.isArray(x) ? x[0] : x;
  const d = String(o?.["dial-rule-translation-destination-user"] ?? "").trim();
  return d && d !== "[*]" ? d : null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const u = new URL(req.url);
  const mode = u.searchParams.get("mode") ?? "verify";
  const offset = Number(u.searchParams.get("offset") ?? 0);
  const limit = Number(u.searchParams.get("limit") ?? 50);
  const slice = DID_MAP.slice(offset, offset + limit);
  const bad: any[] = []; let ok = 0;
  for (const [did, ext] of slice) {
    const cur = await ns(`/domains/${DOM}/phonenumbers/${did}`);
    if (dest(cur.data) === ext) { ok++; continue; }
    if (mode === "verify") { bad.push({ did, ext, live: dest(cur.data), status: cur.status }); continue; }
    const put = await ns(`/domains/${DOM}/phonenumbers/${did}`, {
      method: "PUT",
      body: JSON.stringify({
        "dial-rule-application": "to-user-residential",
        "dial-rule-parameter": `user_${ext}`,
        "dial-rule-translation-destination-user": ext,
        "dial-rule-translation-destination-host": DOM,
        "dial-rule-translation-source-name": "[*]",
        enabled: "yes",
      }),
    });
    const rb = await ns(`/domains/${DOM}/phonenumbers/${did}`);
    if (dest(rb.data) === ext) ok++;
    else bad.push({ did, ext, put: put.status, err: put.data, live: dest(rb.data) });
  }
  return new Response(JSON.stringify({ mode, offset, limit, total: DID_MAP.length, ok, bad: bad.slice(0, 10), badCount: bad.length, next: offset + limit < DID_MAP.length ? offset + limit : null }), { headers: { ...cors, "Content-Type": "application/json" } });
});
