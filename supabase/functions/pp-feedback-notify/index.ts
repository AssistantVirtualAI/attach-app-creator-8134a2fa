// Emails the Planiprêt team when a broker submits a feedback report (portal or mobile).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const SEV: Record<string, string> = { low: "Mineur", normal: "Normal", high: "Élevé", blocker: "Bloquant" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const internal = (req.headers.get("Authorization") ?? "") === `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;
  const { data: ud } = internal ? { data: null as any } : await userClient.auth.getUser();
  if (!internal && !ud?.user) return json({ error: "not_authenticated" }, 401);

  const body = await req.json().catch(() => ({}));
  const id = typeof body?.report_id === "string" && /^[0-9a-f-]{36}$/i.test(body.report_id) ? body.report_id : null;
  if (!id) return json({ error: "invalid_report_id" }, 400);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: r } = await admin.from("pp_feedback_reports").select("*").eq("id", id).maybeSingle();
  if (!r || (!internal && r.reporter_id !== ud.user.id)) return json({ error: "not_found" }, 404);
  let email = ud?.user?.email as string | undefined;
  if (!email) { const { data: au } = await admin.auth.admin.getUserById(r.reporter_id); email = au?.user?.email ?? undefined; }

  const key = Deno.env.get("RESEND_API_KEY");
  const to = (Deno.env.get("PP_FEEDBACK_EMAIL") || Deno.env.get("ADMIN_NOTIFICATION_EMAIL") || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (!key || !to.length) return json({ error: "email_not_configured" }, 500);

  const shots: string[] = [];
  for (const p of (Array.isArray(r.screenshots) ? r.screenshots : []) as string[]) {
    const { data } = await admin.storage.from("pp-feedback-screenshots").createSignedUrl(p, 60 * 60 * 24 * 7);
    if (data?.signedUrl) shots.push(data.signedUrl);
  }
  const src = r.source === "mobile" ? "App mobile" : r.source === "ava_chat" ? "AVA chat" : r.source === "ava_voice" ? "AVA vocal" : "Portail courtier";
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#ffffff;color:#1A2540;max-width:620px;margin:auto;padding:24px">
<h2 style="color:#1A4A8A;margin:0 0 8px">Nouveau feedback — ${esc(r.title)}</h2>
<p style="color:#6B7280;font-size:13px;margin:0 0 16px">${esc(r.reporter_name || email)} · ${esc(email)} · ${src} · Gravité : <b>${esc(SEV[r.severity] ?? r.severity)}</b>${r.page ? ` · Page : ${esc(r.page)}` : ""}</p>
<div style="white-space:pre-wrap;background:#F1F7FE;border-radius:10px;padding:14px;font-size:14px">${esc(r.description || "(aucune description)")}</div>
${shots.length ? `<h3 style="color:#1A4A8A;margin-top:20px">Captures (${shots.length})</h3>${shots.map((u, i) =>
  `<a href="${esc(u)}"><img src="${esc(u)}" alt="Capture ${i + 1}" style="max-width:100%;border:1px solid #E5E7EB;border-radius:8px;margin:6px 0"/></a>`).join("")}
<p style="font-size:11px;color:#9CA3AF">Liens valides 7 jours.</p>` : ""}
<p style="margin-top:24px"><a href="https://courtierai.planipret.com/planipret/broker/feedback" style="background:#1A4A8A;color:#ffffff;padding:10px 16px;border-radius:8px;text-decoration:none">Ouvrir le feedback</a></p>
</body></html>`;

  const send = (from: string) => fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, ...(email ? { reply_to: email } : {}), subject: `[Feedback ${src}] ${r.title}`, html }),
  });
  let res = await send("Planiprêt Feedback <noreply@ava-telecom.ca>");
  if (!res.ok) res = await send("Planiprêt Feedback <onboarding@resend.dev>");
  if (!res.ok) { console.error("[pp-feedback-notify]", res.status, await res.text()); return json({ error: "send_failed" }, 502); }
  return json({ ok: true });
});
