// Lemtel — announce a new desktop release by email to every active Lemtel user, exactly once per version.
// Triggered by the desktop release workflow (anonymous, apikey only) right after publishing, and by a platform
// administrator from the portal. The trigger carries no data: the server itself reads the newest COMPLETE GitHub
// release (all three installers uploaded), so a caller can never choose a version, a recipient or a link.
// Idempotent: a version is claimed once; a run that hits its time budget is "partial" and the next call resumes
// it, skipping every user already accepted by the provider. Responses carry counts only, never an address.
import { createClient } from "npm:@supabase/supabase-js@2";
import { compareVersions, latestDesktopRelease, type DesktopRelease } from "../_shared/lemtelDesktopRelease.ts";
import { emailConfig, releaseAnnouncementMessage, sendWithResend, type TransactionalEmailConfig } from "../_shared/lemtelTransactionalEmail.ts";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const STALE_CLAIM_MS = 15 * 60 * 1000;
const MAX_RECIPIENTS = 5000;

// deno-lint-ignore no-explicit-any
type Admin = any;
export type Deps = {
  admin: Admin;
  release: (force: boolean) => Promise<DesktopRelease>;
  email: () => TransactionalEmailConfig | undefined;
  send: typeof sendWithResend;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  budgetMs: number;
  spacingMs: number;
};

let lastForcedRefresh = 0;

async function platformAdministrator(admin: Admin, req: Request): Promise<"anonymous" | "platform_admin" | "forbidden"> {
  const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return "anonymous";
  const { data } = await admin.auth.getUser(token).catch(() => ({ data: null }));
  const userId = data?.user?.id;
  if (!userId) return "anonymous"; // the publishable (anon) key is not a user session
  const { data: row } = await admin.from("lemtel_platform_administrators").select("user_id").eq("user_id", userId).eq("status", "active").maybeSingle();
  return row?.user_id ? "platform_admin" : "forbidden";
}

type Claim = { owned: true; resumed: boolean } | { owned: false; status: string };

/** Claims the version for this run: new row, or a partial / stale run to resume. Never a newer-than-announced check bypass. */
export async function claim(admin: Admin, version: string, trigger: string, now: number): Promise<Claim> {
  const { data: rows } = await admin.from("lemtel_desktop_release_announcements").select("version,state,claimed_at");
  const all = (rows ?? []) as Array<{ version: string; state: string; claimed_at: string }>;
  const newest = all.reduce<string | null>((acc, r) => (!acc || compareVersions(r.version, acc) > 0 ? r.version : acc), null);
  const existing = all.find((r) => r.version === version);
  if (!existing) {
    if (newest && compareVersions(version, newest) < 0) return { owned: false, status: "older_than_announced" };
    const { error } = await admin.from("lemtel_desktop_release_announcements").insert({ version, state: "sending", triggered_by: trigger, claimed_at: new Date(now).toISOString() });
    return error ? { owned: false, status: "in_progress" } : { owned: true, resumed: false };
  }
  if (existing.state === "sent" || existing.state === "baseline") return { owned: false, status: "already_announced" };
  if (existing.state === "sending" && now - Date.parse(existing.claimed_at) < STALE_CLAIM_MS) return { owned: false, status: "in_progress" };
  const { data: updated } = await admin.from("lemtel_desktop_release_announcements").update({ state: "sending", claimed_at: new Date(now).toISOString() })
    .eq("version", version).eq("state", existing.state).eq("claimed_at", existing.claimed_at).select("version");
  return updated?.length ? { owned: true, resumed: true } : { owned: false, status: "in_progress" };
}

type Recipient = { userId: string; email: string; name: string; locale: "fr" | "en" };

export async function recipients(admin: Admin, now: number): Promise<Recipient[]> {
  const [{ data: orgs }, { data: members }] = await Promise.all([
    admin.from("lemtel_organizations").select("id").eq("status", "active"),
    admin.from("lemtel_organization_memberships").select("organization_id,user_id").eq("status", "active").limit(MAX_RECIPIENTS * 2),
  ]);
  const activeOrgs = new Set(((orgs ?? []) as Array<{ id: string }>).map((o) => o.id));
  const ids = [...new Set(((members ?? []) as Array<{ organization_id: string; user_id: string }>).filter((m) => activeOrgs.has(m.organization_id)).map((m) => m.user_id))].slice(0, MAX_RECIPIENTS);
  const out: Recipient[] = [];
  for (const id of ids) {
    const { data } = await admin.auth.admin.getUserById(id);
    const u = data?.user;
    if (!u?.email) continue;
    if (u.banned_until && Date.parse(u.banned_until) > now) continue;
    out.push({ userId: id, email: u.email, name: String(u.user_metadata?.full_name || u.email), locale: u.user_metadata?.locale === "en" ? "en" : "fr" });
  }
  return out;
}

export async function handle(req: Request, d: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  if (req.method !== "POST") return respond({ error: "method_not_allowed" }, 405);
  let raw: unknown = {};
  try { const text = await req.text(); raw = text ? JSON.parse(text) : {}; } catch { return respond({ error: "invalid_json" }, 400); }
  const plain = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  const keys = plain ? Object.keys(plain) : null;
  const isStatus = keys?.length === 1 && plain?.action === "status";
  if (!keys || (keys.length && !isStatus)) return respond({ error: "invalid_request" }, 400);
  const caller = await platformAdministrator(d.admin, req);
  if (caller === "forbidden") return respond({ error: "forbidden" }, 403);
  if (isStatus) {
    // Platform administrators only: newest release and the announcement history (counts, never addresses).
    if (caller !== "platform_admin") return respond({ error: "unauthorized" }, 401);
    const release = await d.release(false);
    const { data } = await d.admin.from("lemtel_desktop_release_announcements").select("version,state,triggered_by,recipients,accepted,failed,created_at,completed_at");
    const history = ((data ?? []) as Array<Record<string, unknown>>).sort((a, b) => compareVersions(String(b.version), String(a.version))).slice(0, 10)
      .map((r) => ({ version: r.version, state: r.state, triggeredBy: r.triggered_by, recipients: r.recipients, accepted: r.accepted, failed: r.failed, createdAt: r.created_at, completedAt: r.completed_at }));
    return respond({ latest: { version: release.version, source: release.source, publishedAt: release.publishedAt, releaseUrl: release.releaseUrl }, history });
  }
  const started = d.now();
  // A forced GitHub read at most every 30 s (an anonymous caller cannot exhaust the API quota).
  const force = started - lastForcedRefresh > 30_000;
  if (force) lastForcedRefresh = started;
  const release = await d.release(force);
  if (release.source !== "github_latest") return respond({ status: "no_complete_release" });
  const config = d.email();
  if (!config) return respond({ error: "email_delivery_unavailable" }, 503);

  const trigger = caller === "platform_admin" ? "platform_admin" : "release_workflow";
  const c = await claim(d.admin, release.version, trigger, started);
  if (!c.owned) return respond({ status: c.status, version: release.version });

  const { data: done } = await d.admin.from("lemtel_desktop_release_deliveries").select("user_id").eq("version", release.version).eq("state", "provider_accepted");
  const already = new Set(((done ?? []) as Array<{ user_id: string }>).map((r) => r.user_id));
  const people = await recipients(d.admin, started);
  const pending = people.filter((p) => !already.has(p.userId));
  let accepted = 0, failed = 0, remaining = pending.length;
  for (const p of pending) {
    if (d.now() - started > d.budgetMs) break;
    let ok = false, providerMessageId: string | undefined;
    try {
      const message = releaseAnnouncementMessage({ locale: p.locale, displayName: p.name, release, logoUrl: config.logoUrl });
      const r = await d.send(config, p.email, message);
      ok = r.accepted; providerMessageId = r.accepted ? r.providerMessageId : undefined;
    } catch { ok = false; }
    await d.admin.from("lemtel_desktop_release_deliveries").upsert({ version: release.version, user_id: p.userId, state: ok ? "provider_accepted" : "failed",
      provider_message_id: providerMessageId ?? null, updated_at: new Date(d.now()).toISOString() }, { onConflict: "version,user_id" });
    if (ok) accepted++; else failed++;
    remaining--;
    if (remaining > 0) await d.sleep(d.spacingMs);
  }
  const { data: totals } = await d.admin.from("lemtel_desktop_release_deliveries").select("state").eq("version", release.version);
  const t = (totals ?? []) as Array<{ state: string }>;
  const totalAccepted = t.filter((x) => x.state === "provider_accepted").length;
  const totalFailed = t.filter((x) => x.state === "failed").length;
  const complete = remaining === 0 && failed === 0;
  await d.admin.from("lemtel_desktop_release_announcements").update({
    state: complete ? "sent" : "partial", recipients: people.length, accepted: totalAccepted, failed: totalFailed,
    completed_at: complete ? new Date(d.now()).toISOString() : null,
  }).eq("version", release.version);
  return respond({ status: complete ? "sent" : "partial", version: release.version, recipients: people.length, acceptedThisRun: accepted, failedThisRun: failed, remaining, resumed: c.resumed });
}

if (import.meta.main) {
  Deno.serve((req) => {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!url || !serviceRoleKey) return respond({ error: "server_not_configured" }, 503);
    const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    return handle(req, {
      admin,
      release: (force) => latestDesktopRelease(fetch, Date.now(), force),
      email: () => emailConfig(Deno.env),
      send: sendWithResend,
      now: Date.now,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      budgetMs: 100_000,
      spacingMs: 600, // Resend default limit is 2 requests per second
    });
  });
}
