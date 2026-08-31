// Hourly reminder emails for Maestro tasks that are overdue or due soon.
//
// Source of truth: `planipret_tasks_projection` (mirror of the Maestro task
// list maintained by `planipret-task-api`). One email per task and per kind
// (`due_soon`, `overdue`), deduplicated through `planipret_task_reminders`.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const APP_BASE = (Deno.env.get("PLANIPRET_APP_BASE_URL") ?? "https://avastatistic.ca").replace(/\/$/, "");
const TASKS_URL = `${APP_BASE}/mplanipret/tasks`;

/** Tasks due within this window trigger the "due soon" reminder. */
const DUE_SOON_HOURS = 24;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const isDone = (status: unknown) =>
  ["done", "completed", "complete", "closed", "cancelled", "canceled"].includes(String(status ?? "").toLowerCase());

function fmtDue(due: string | null): string {
  if (!due) return "—";
  try {
    return new Intl.DateTimeFormat("fr-CA", {
      dateStyle: "medium", timeStyle: "short", timeZone: "America/Toronto",
    }).format(new Date(due));
  } catch { return due; }
}

function buildHtml(opts: { firstName: string; kind: "overdue" | "due_soon"; title: string; due: string | null; notes: string }) {
  const overdue = opts.kind === "overdue";
  const accent = overdue ? "#DC2626" : "#1A4A8A";
  const badge = overdue ? "Tâche en retard" : "Échéance dans moins de 24 h";
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;padding:24px;color:#1A2540;background:#ffffff">
<p style="display:inline-block;margin:0 0 12px;padding:6px 12px;border-radius:999px;background:${accent}1A;color:${accent};font-weight:700;font-size:12px">${badge}</p>
<h2 style="color:${accent};margin:0 0 8px">Bonjour ${opts.firstName || ""},</h2>
<p style="margin:0 0 16px">Rappel concernant une tâche Maestro&nbsp;:</p>
<div style="padding:14px;border:1px solid #E2E8F0;border-radius:10px;background:#F8FAFC">
  <p style="margin:0 0 6px;font-weight:700">${opts.title}</p>
  <p style="margin:0;font-size:13px;color:#475569">Échéance&nbsp;: <strong>${fmtDue(opts.due)}</strong></p>
  ${opts.notes ? `<p style="margin:8px 0 0;font-size:13px;color:#475569">${opts.notes}</p>` : ""}
</div>
<p style="margin:22px 0"><a href="${TASKS_URL}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700">Ouvrir mes tâches dans l'app</a></p>
<p style="font-size:12px;color:#6B7280">Lien direct&nbsp;: <a href="${TASKS_URL}" style="color:${accent}">${TASKS_URL}</a></p>
<p style="font-size:12px;color:#6B7280;margin-top:28px">— L'équipe Planiprêt</p>
</body></html>`;
}

async function sendEmail(to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Planiprêt <onboarding@resend.dev>", to: [to], subject, html }),
  });
  if (!res.ok) return { ok: false, error: `${res.status} ${(await res.text()).slice(0, 200)}` };
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Auth: cron secret, service role, or a Planiprêt admin triggering a dry/manual run.
  const authHeader = req.headers.get("Authorization") ?? "";
  const cronHeader = req.headers.get("x-cron-secret") ?? "";
  const secrets = [Deno.env.get("PP_CRON_SECRET"), Deno.env.get("CRON_PBX_SECRET"), Deno.env.get("CRON_SECRET")]
    .filter((v): v is string => !!v);
  let allowed = (!!SERVICE_KEY && authHeader === `Bearer ${SERVICE_KEY}`) || (!!cronHeader && secrets.includes(cronHeader));
  if (!allowed && authHeader) {
    const { data: u } = await admin.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
    if (u?.user) {
      const { data: isAdmin } = await admin.rpc("is_planipret_admin", { _user_id: u.user.id });
      allowed = Boolean(isAdmin);
    }
  }
  if (!allowed) return json({ success: false, error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({} as any));
  const dryRun = body?.dry_run === true;
  if (!RESEND_API_KEY && !dryRun) return json({ success: false, error: "resend_not_configured" }, 500);

  const now = Date.now();
  const horizon = new Date(now + DUE_SOON_HOURS * 3600_000).toISOString();
  const floor = new Date(now - 30 * 24 * 3600_000).toISOString(); // ignore very old backlog

  const { data: rows, error } = await admin
    .from("planipret_tasks_projection")
    .select("user_id, task_id, due_at, status, payload")
    .is("deleted_at", null)
    .not("due_at", "is", null)
    .gte("due_at", floor)
    .lte("due_at", horizon)
    .order("due_at", { ascending: true })
    .limit(1000);
  if (error) return json({ success: false, error: error.message }, 500);

  const candidates = (rows ?? []).filter((r: any) => !isDone(r.status ?? r.payload?.status));
  if (!candidates.length) return json({ success: true, scanned: 0, sent: 0, skipped: 0 });

  // Recipients (auth user id → email / first name).
  const userIds = [...new Set(candidates.map((r: any) => r.user_id))];
  const { data: profiles } = await admin
    .from("planipret_profiles")
    .select("user_id, id, email, ms365_email, full_name, first_name")
    .or(`user_id.in.(${userIds.join(",")}),id.in.(${userIds.join(",")})`);
  const byId = new Map<string, any>();
  for (const p of (profiles ?? []) as any[]) {
    if (p.user_id) byId.set(String(p.user_id), p);
    if (p.id) byId.set(String(p.id), p);
  }

  // Already-notified pairs.
  const { data: sentRows } = await admin
    .from("planipret_task_reminders")
    .select("user_id, task_id, kind")
    .in("user_id", userIds);
  const already = new Set((sentRows ?? []).map((r: any) => `${r.user_id}|${r.task_id}|${r.kind}`));

  let sent = 0, skipped = 0;
  const failures: { task_id: string; error: string }[] = [];

  for (const row of candidates as any[]) {
    const due = row.due_at as string;
    const kind: "overdue" | "due_soon" = new Date(due).getTime() < now ? "overdue" : "due_soon";
    const key = `${row.user_id}|${row.task_id}|${kind}`;
    if (already.has(key)) { skipped += 1; continue; }

    const prof = byId.get(String(row.user_id));
    const to = String(prof?.email || prof?.ms365_email || "").trim();
    if (!to) { skipped += 1; continue; }

    const payload = row.payload ?? {};
    const title = String(payload.title || payload.subject || payload.notes || "Tâche Maestro").slice(0, 120);
    const notes = String(payload.notes ?? "").slice(0, 300);
    const firstName = String(prof?.first_name || String(prof?.full_name ?? "").split(" ")[0] || "");
    const subject = kind === "overdue"
      ? `⏰ Tâche en retard — ${title}`
      : `📌 Échéance demain — ${title}`;

    if (dryRun) { sent += 1; already.add(key); continue; }

    const res = await sendEmail(to, subject, buildHtml({ firstName, kind, title, due, notes }));
    if (!res.ok) { failures.push({ task_id: row.task_id, error: res.error ?? "send_failed" }); continue; }

    await admin.from("planipret_task_reminders").upsert(
      { user_id: row.user_id, task_id: String(row.task_id), kind, due_at: due, email: to },
      { onConflict: "user_id,task_id,kind" },
    );
    already.add(key);
    sent += 1;
  }

  return json({ success: true, scanned: candidates.length, sent, skipped, failures, dry_run: dryRun });
});
