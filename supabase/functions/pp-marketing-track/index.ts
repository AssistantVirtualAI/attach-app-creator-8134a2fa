// GET — pixel d'ouverture, redirection de clic, désabonnement (jeton opaque).
import { adminClient, corsHeaders } from "../_shared/pp-marketing.ts";

const PIXEL = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));
const pixel = () => new Response(PIXEL, { headers: { "Content-Type": "image/gif", "Cache-Control": "no-store" } });
const html = (msg: string) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:Arial;padding:40px;text-align:center;color:#0B3656"><h2>Planiprêt</h2><p>${msg}</p></body>`,
  { headers: { "Content-Type": "text/html; charset=utf-8" } },
);

async function bump(admin: any, campaignId: string, field: "opened_count" | "clicked_count") {
  const { data } = await admin.from("planipret_marketing_campaigns").select(field).eq("id", campaignId).maybeSingle();
  if (data) await admin.from("planipret_marketing_campaigns").update({ [field]: (data[field] ?? 0) + 1 }).eq("id", campaignId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const u = new URL(req.url);
  const a = u.searchParams.get("a");
  const token = u.searchParams.get("c") ?? "";
  const admin = adminClient();
  const valid = /^[a-f0-9]{32}$/.test(token);
  const { data: r } = valid
    ? await admin.from("planipret_marketing_recipients").select("id, campaign_id, email, phone, status, opened_at, clicked_at").eq("track_token", token).maybeSingle()
    : { data: null };

  if (a === "open") {
    if (r && !r.opened_at) {
      await admin.from("planipret_marketing_recipients").update({ opened_at: new Date().toISOString(), status: r.status === "clicked" ? "clicked" : "opened" }).eq("id", r.id);
      await bump(admin, r.campaign_id, "opened_count");
    }
    return pixel();
  }
  if (a === "click") {
    const target = u.searchParams.get("u") ?? "";
    const safe = /^https?:\/\//i.test(target) ? target : "https://planipret.com";
    if (r && !r.clicked_at) {
      const now = new Date().toISOString();
      await admin.from("planipret_marketing_recipients").update({ clicked_at: now, opened_at: r.opened_at ?? now, status: "clicked" }).eq("id", r.id);
      await bump(admin, r.campaign_id, "clicked_count");
      if (!r.opened_at) await bump(admin, r.campaign_id, "opened_count");
    }
    return new Response(null, { status: 302, headers: { Location: safe } });
  }
  if (a === "unsub") {
    if (!r) return html("Lien invalide.");
    if (r.email) {
      const { data: ex } = await admin.from("planipret_marketing_optouts").select("id").eq("email", r.email.toLowerCase()).maybeSingle();
      if (!ex) await admin.from("planipret_marketing_optouts").insert({ email: r.email.toLowerCase(), reason: "lien_courriel" });
    }
    return html("Vous êtes désabonné(e). Vous ne recevrez plus nos courriels marketing.");
  }
  return html("Lien invalide.");
});
