// Shared helpers for the broker Marketing page (compose / send / track).
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

export { corsHeaders };
export const PORTAL_ORIGIN = "https://courtierai.planipret.com";
export const PLANIPRET_LOGO_URL =
  `${PORTAL_ORIGIN}/__l5e/assets-v1/e3dd3a86-14ac-4585-8736-b102e9737302/planipret-logo.png`;
export const EMAIL_RE = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[a-z]{2,}$/i;

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

export async function requireBroker(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return { error: json({ ok: false, error: "unauthorized" }, 401) };
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: u, error } = await userClient.auth.getUser(auth.slice(7));
  if (error || !u?.user) return { error: json({ ok: false, error: "unauthorized" }, 401) };
  const admin = adminClient();
  const userId = u.user.id;
  const [{ data: member }, { data: isAdmin }] = await Promise.all([
    admin.rpc("is_planipret_member", { _user_id: userId }),
    admin.rpc("is_planipret_admin", { _user_id: userId }),
  ]);
  if (!member && !isAdmin) return { error: json({ ok: false, error: "forbidden" }, 403) };
  const { data: profile } = await admin.from("planipret_profiles").select("*").eq("user_id", userId).maybeSingle();
  return { userId, profile: profile ?? {}, isAdmin: !!isAdmin, admin, auth };
}

export function brokerSignature(p: any) {
  return {
    name: String(p?.full_name ?? "").trim() || "Votre courtier Planiprêt",
    title: "Courtier hypothécaire · Planiprêt",
    phone: String(p?.phone ?? "").trim() || null,
    email: String(p?.ms365_email ?? p?.email ?? "").trim() || null,
  };
}

export function normalizeE164(v: unknown): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function trackBaseUrl() {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/pp-marketing-track`;
}

export function renderEmailHtml(o: {
  bodyHtml: string;
  signature: ReturnType<typeof brokerSignature>;
  unsubscribeUrl?: string | null;
  pixelUrl?: string | null;
}) {
  const s = o.signature;
  return `<!doctype html><html><body style="margin:0;background:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#1b2a3a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6fa;padding:24px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#0B3656;padding:18px 24px"><img src="${PLANIPRET_LOGO_URL}" alt="Planiprêt" height="34" style="display:block;height:34px"></td></tr>
<tr><td style="padding:28px 28px 8px;font-size:15px;line-height:1.6">${o.bodyHtml}</td></tr>
<tr><td style="padding:16px 28px 28px;border-top:1px solid #e6ebf1;font-size:13px;line-height:1.5">
<strong style="color:#0B3656">${esc(s.name)}</strong><br>${esc(s.title)}${s.phone ? `<br>${esc(s.phone)}` : ""}${s.email ? `<br><a href="mailto:${esc(s.email)}" style="color:#176FAD">${esc(s.email)}</a>` : ""}
</td></tr></table>
${o.unsubscribeUrl ? `<p style="font-size:11px;color:#7a8896;margin:14px 0">Vous ne souhaitez plus recevoir ces courriels? <a href="${o.unsubscribeUrl}" style="color:#7a8896">Se désabonner</a></p>` : ""}
${o.pixelUrl ? `<img src="${o.pixelUrl}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">` : ""}
</td></tr></table></body></html>`;
}

export function rewriteLinks(html: string, token: string) {
  const base = trackBaseUrl();
  return html.replace(/href="(https?:\/\/[^"]+)"/gi, (_m, url) =>
    `href="${base}?a=click&c=${encodeURIComponent(token)}&u=${encodeURIComponent(url)}"`);
}
