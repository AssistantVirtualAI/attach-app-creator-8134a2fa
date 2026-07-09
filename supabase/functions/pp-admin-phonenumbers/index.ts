// Manage NetSapiens DIDs (phone numbers) for the Planiprêt domain.
// Actions: list, assign, unassign
import { corsHeaders, jsonResponse, requirePlanipretAdmin } from "../_shared/ns-broker.ts";

const NS_API_KEY = Deno.env.get("NS_API_KEY") ?? "";
const NS_API_BASE_URL = Deno.env.get("NS_API_BASE_URL") ?? "https://voice.ava-telecom.ca/ns-api/v2";
const NS_DEFAULT_DOMAIN = Deno.env.get("NS_DEFAULT_DOMAIN") ?? "planipret.ca";

async function nsFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${NS_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${NS_API_KEY}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

async function nsFetchFirstOk(paths: string[], init: RequestInit = {}) {
  let last: any = null;
  for (const p of paths) {
    const r = await nsFetch(p, init);
    if (r.ok) return r;
    last = r;
  }
  return last ?? { ok: false, status: 0, data: null };
}

function normalizeE164(raw: any): string {
  const s = String(raw ?? "").replace(/[^\d+]/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.length === 10) return `+1${s}`;
  if (s.length === 11 && s.startsWith("1")) return `+${s}`;
  return `+${s}`;
}

function pretty(num: string): string {
  const d = num.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) {
    return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  }
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return num;
}

function extractDest(pn: any): { extension: string | null; type: string | null } {
  // NetSapiens phone number destination fields vary between versions.
  const destUser = pn?.["to-user"] ?? pn?.["dest-user"] ?? pn?.dest ?? pn?.destination ?? null;
  const app = pn?.["dest-application"] ?? pn?.application ?? pn?.["destination-application"] ?? null;
  let ext: string | null = null;
  if (destUser && typeof destUser === "string") {
    // strip "@domain" if present
    ext = destUser.split("@")[0] || null;
    if (ext && !/^\d+$/.test(ext)) ext = null;
  }
  return { extension: ext, type: app ? String(app) : null };
}

function normalizeNumber(pn: any): {
  raw: string;
  e164: string;
  pretty: string;
  extension: string | null;
  application: string | null;
  active: boolean;
  ns: any;
} {
  const raw = String(
    pn?.phonenumber ?? pn?.["phone-number"] ?? pn?.number ?? pn?.dnis ?? pn?.did ?? "",
  );
  const e164 = normalizeE164(raw);
  const dest = extractDest(pn);
  const active = (pn?.["enable"] ?? pn?.enabled ?? pn?.status ?? "yes") !== "no";
  return { raw, e164, pretty: pretty(e164 || raw), extension: dest.extension, application: dest.type, active, ns: pn };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await requirePlanipretAdmin(req);
    if ("error" in auth) return auth.error;

    if (!NS_API_KEY) return jsonResponse({ success: false, error: "NS_API_KEY not configured" }, 500);

    const body = await req.json().catch(() => ({}));
    const { action, payload } = body ?? {};
    const domain = String(payload?.domain ?? NS_DEFAULT_DOMAIN);

    if (action === "list" || !action) {
      const r = await nsFetchFirstOk([
        `/domains/${encodeURIComponent(domain)}/phonenumbers?limit=1000`,
        `/domains/${encodeURIComponent(domain)}/phone-numbers?limit=1000`,
        `/domains/${encodeURIComponent(domain)}/numbers?limit=1000`,
      ]);
      if (!r.ok) {
        return jsonResponse({
          success: false,
          error: `NS-API list failed (${r.status})`,
          detail: r.data,
        }, 200);
      }
      const raw = Array.isArray(r.data) ? r.data : (r.data?.data ?? r.data?.items ?? []);
      const numbers = (raw ?? []).map(normalizeNumber).filter((n: any) => n.raw);
      return jsonResponse({ success: true, domain, count: numbers.length, numbers });
    }

    if (action === "assign") {
      const { phone_number, extension } = payload ?? {};
      if (!phone_number || !extension) {
        return jsonResponse({ success: false, error: "phone_number et extension requis" }, 400);
      }
      const pn = String(phone_number).replace(/[^\d]/g, "");
      const ext = String(extension);
      const assignBody = {
        "dest-application": "to-user",
        application: "to-user",
        "to-user": `${ext}@${domain}`,
        "dest-user": ext,
        dest: ext,
        "dest-type": "user",
        enable: "yes",
      };
      const r = await nsFetchFirstOk([
        `/domains/${encodeURIComponent(domain)}/phonenumbers/${encodeURIComponent(pn)}`,
        `/domains/${encodeURIComponent(domain)}/phone-numbers/${encodeURIComponent(pn)}`,
      ], { method: "PUT", body: JSON.stringify(assignBody) });
      if (!r.ok) {
        return jsonResponse({ success: false, error: `NS assign failed (${r.status})`, detail: r.data }, 200);
      }
      return jsonResponse({ success: true, phone_number: pn, extension: ext });
    }

    if (action === "unassign") {
      const { phone_number } = payload ?? {};
      if (!phone_number) return jsonResponse({ success: false, error: "phone_number requis" }, 400);
      const pn = String(phone_number).replace(/[^\d]/g, "");
      const clearBody = {
        "dest-application": "to-voicemail",
        application: "to-voicemail",
        "to-user": "",
        "dest-user": "",
        dest: "",
      };
      const r = await nsFetchFirstOk([
        `/domains/${encodeURIComponent(domain)}/phonenumbers/${encodeURIComponent(pn)}`,
        `/domains/${encodeURIComponent(domain)}/phone-numbers/${encodeURIComponent(pn)}`,
      ], { method: "PUT", body: JSON.stringify(clearBody) });
      if (!r.ok) return jsonResponse({ success: false, error: `NS unassign failed (${r.status})`, detail: r.data }, 200);
      return jsonResponse({ success: true, phone_number: pn });
    }

    return jsonResponse({ success: false, error: "Action inconnue" }, 400);
  } catch (e) {
    console.error("pp-admin-phonenumbers", e);
    return jsonResponse({ success: false, error: String(e) }, 200);
  }
});
