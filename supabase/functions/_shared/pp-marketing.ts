// Helpers partagés pour les campagnes marketing Planiprêt (texto + courriel).
// Aucune donnée personnelle ni secret n'est journalisé ici.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

export const PORTAL_ORIGIN = "https://courtierai.planipret.com";
export const PLANIPRET_LOGO_URL =
  `${PORTAL_ORIGIN}/__l5e/assets-v1/e3dd3a86-14ac-4585-8736-b102e9737302/planipret-logo.png`;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export type MarketingCtx = {
  userId: string;
  profile: Record<string, any> | null;
  isAdmin: boolean;
  admin: ReturnType<typeof adminClient>;
};

/** Authentifie un courtier Planiprêt (JWT obligatoire). */
export async function requireBroker(req: Request): Promise<MarketingCtx | Response> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ ok: false, error: "unauthorized" }, 401);
  const admin = adminClient();
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data, error } = await admin.auth.getUser(token);
  const userId = data?.user?.id;
  if (error || !userId) return json({ ok: false, error: "unauthorized" }, 401);

  const { data: member } = await admin.rpc("is_planipret_member", { _user_id: userId });
  if (member !== true) return json({ ok: false, error: "forbidden" }, 403);
  const { data: isAdmin } = await admin.rpc("is_planipret_admin", { _user_id: userId });

  const { data: profile } = await admin
    .from("planipret_profiles")
    .select("id, user_id, full_name, email, ms365_email, phone, extension, role, title")
    .or(`user_id.eq.${userId},id.eq.${userId}`)
    .limit(1)
    .maybeSingle();

  return { userId, profile: profile ?? null, isAdmin: isAdmin === true, admin };
}

export function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeE164(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits || digits.length < 10) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

export type BrokerSignature = {
  name: string;
  title: string;
  phone: string;
  email: string;
};

export function brokerSignature(profile: Record<string, any> | null): BrokerSignature {
  return {
    name: String(profile?.full_name ?? "").trim(),
    title: String(profile?.title ?? "").trim() || "Courtier hypothécaire",
    phone: String(profile?.phone ?? "").trim(),
    email: String(profile?.ms365_email ?? profile?.email ?? "").trim(),
  };
}

/**
 * Enveloppe le corps généré par l'IA dans le gabarit Planiprêt :
 * logo, couleurs de marque, signature du courtier, lien de désabonnement.
 */
export function renderEmailHtml(opts: {
  bodyHtml: string;
  signature: BrokerSignature;
  unsubscribeUrl?: string;
  pixelUrl?: string;
}): string {
  const s = opts.signature;
  const sigLines = [
    s.name && `<div style="font-weight:600;color:#0b1b3a">${escapeHtml(s.name)}</div>`,
    s.title && `<div style="color:#5b6577">${escapeHtml(s.title)}</div>`,
    s.phone && `<div style="color:#5b6577">${escapeHtml(s.phone)}</div>`,
    s.email &&
      `<div><a href="mailto:${escapeHtml(s.email)}" style="color:#0b3fa8">${escapeHtml(s.email)}</a></div>`,
  ].filter(Boolean).join("");

  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f6fb;font-family:Segoe UI,Inter,Arial,sans-serif;color:#1b2333">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e3e8f2">
    <div style="padding:20px 24px;border-bottom:1px solid #eef1f7;text-align:left">
      <img src="${PLANIPRET_LOGO_URL}" alt="Planiprêt" height="34" style="height:34px;display:block" />
    </div>
    <div style="padding:24px;font-size:15px;line-height:1.6">
      ${opts.bodyHtml}
    </div>
    <div style="padding:20px 24px;border-top:1px solid #eef1f7;font-size:13px;line-height:1.5">
      ${sigLines}
    </div>
    <div style="padding:14px 24px;background:#f8fafc;font-size:11px;color:#8a93a5;text-align:center">
      ${opts.unsubscribeUrl ? `<a href="${opts.unsubscribeUrl}" style="color:#8a93a5">Se désabonner de ces communications</a>` : ""}
    </div>
  </div>
  ${opts.pixelUrl ? `<img src="${opts.pixelUrl}" width="1" height="1" alt="" style="display:none" />` : ""}
</body></html>`;
}

export function trackBaseUrl(): string {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/pp-marketing-track`;
}

/** Réécrit les liens http(s) du corps pour passer par la redirection de suivi. */
export function rewriteLinks(html: string, token: string): string {
  const base = trackBaseUrl();
  return html.replace(/href="(https?:\/\/[^"]+)"/g, (_m, url) =>
    `href="${base}?c=${encodeURIComponent(token)}&u=${encodeURIComponent(url)}"`);
}
