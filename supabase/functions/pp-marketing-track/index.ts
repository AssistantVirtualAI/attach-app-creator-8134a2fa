// pp-marketing-track — suivi public par jeton opaque : pixel d'ouverture,
// redirection de clic et désabonnement. Aucune donnée personnelle dans l'URL.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient } from "../_shared/pp-marketing.ts";

const PIXEL = Uint8Array.from(atob(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
), (c) => c.charCodeAt(0));

function pixelResponse() {
  return new Response(PIXEL, {
    headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, no-cache, must-revalidate" },
  });
}

function htmlPage(message: string) {
  return new Response(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Planiprêt</title></head>
<body style="margin:0;font-family:Segoe UI,Inter,Arial,sans-serif;background:#f4f6fb;display:flex;align-items:center;justify-content:center;min-height:100vh">
<div style="background:#fff;border:1px solid #e3e8f2;border-radius:14px;padding:32px;max-width:420px;text-align:center;color:#1b2333">
<h1 style="font-size:18px;margin:0 0 8px">Planiprêt</h1><p style="margin:0;color:#5b6577">${message}</p></div></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  const action = url.searchParams.get("a") ?? "open";
  const token = (url.searchParams.get("c") ?? "").trim();
  const target = url.searchParams.get("u") ?? "";

  try {
    if (!token) return action === "open" ? pixelResponse() : htmlPage("Lien invalide.");
    const admin = adminClient();
    const { data: rec } = await admin
      .from("planipret_marketing_recipients")
      .select("id, campaign_id, email, phone, opened_at, clicked_at, status")
      .eq("track_token", token)
      .maybeSingle();

    if (!rec) return action === "open" ? pixelResponse() : htmlPage("Lien invalide.");
    const now = new Date().toISOString();

    const bumpCampaign = async (field: "opened_count" | "clicked_count") => {
      const { data: c } = await admin
        .from("planipret_marketing_campaigns")
        .select(field)
        .eq("id", rec.campaign_id)
        .maybeSingle();
      const current = Number((c as any)?.[field] ?? 0);
      await admin.from("planipret_marketing_campaigns")
        .update({ [field]: current + 1 }).eq("id", rec.campaign_id);
    };

    if (action === "unsub") {
      if (rec.email) {
        await admin.from("planipret_marketing_optouts")
          .upsert({ email: rec.email, reason: "lien_courriel" }, { onConflict: "email" });
      }
      if (rec.phone) {
        await admin.from("planipret_marketing_optouts")
          .upsert({ phone: rec.phone, reason: "lien_courriel" }, { onConflict: "phone" });
      }
      return htmlPage("Vous ne recevrez plus de communications marketing. Merci.");
    }

    if (action === "click") {
      if (!rec.clicked_at) {
        await admin.from("planipret_marketing_recipients")
          .update({ clicked_at: now, opened_at: rec.opened_at ?? now, status: "clicked" })
          .eq("id", rec.id);
        await bumpCampaign("clicked_count");
        if (!rec.opened_at) await bumpCampaign("opened_count");
      }
      const safe = /^https?:\/\//i.test(target) ? target : "https://planipret.com";
      return new Response(null, { status: 302, headers: { Location: safe, "Cache-Control": "no-store" } });
    }

    // open (pixel)
    if (!rec.opened_at) {
      await admin.from("planipret_marketing_recipients")
        .update({ opened_at: now, status: rec.status === "clicked" ? "clicked" : "opened" })
        .eq("id", rec.id);
      await bumpCampaign("opened_count");
    }
    return pixelResponse();
  } catch (e) {
    console.error("[pp-marketing-track] error", String((e as Error)?.message ?? e).slice(0, 200));
    return action === "open" ? pixelResponse() : htmlPage("Lien temporairement indisponible.");
  }
});
