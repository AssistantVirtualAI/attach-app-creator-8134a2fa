// ava-analyze-all — Admin trigger to run ava-email-analyzer across every
// broker with a live Microsoft 365 connection. When no delegated token
// exists we fall back to Azure App Application Permissions.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const GRAPH = "https://graph.microsoft.com/v1.0";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function getMsConfig(admin: any) {
  const { data } = await admin.from("planipret_integration_secrets").select("config").eq("provider", "microsoft").maybeSingle();
  const c = (data?.config ?? {}) as Record<string, string>;
  return {
    clientId: c.client_id ?? Deno.env.get("MICROSOFT_CLIENT_ID") ?? Deno.env.get("MS365_CLIENT_ID") ?? "",
    clientSecret: c.client_secret ?? Deno.env.get("MICROSOFT_CLIENT_SECRET") ?? Deno.env.get("MS365_CLIENT_SECRET") ?? "",
    tenant: c.tenant_id ?? Deno.env.get("MICROSOFT_TENANT_ID") ?? Deno.env.get("MS365_TENANT_ID") ?? "common",
  };
}

async function refreshToken(admin: any, profile: any) {
  const cfg = await getMsConfig(admin);
  if (!profile.ms365_refresh_token || !cfg.clientId) return null;
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "refresh_token",
    refresh_token: profile.ms365_refresh_token,
    scope: "openid profile email offline_access User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite",
  });
  const r = await fetch(`https://login.microsoftonline.com/${cfg.tenant}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  if (!r.ok) return null;
  const d = await r.json();
  await admin.from("planipret_profiles").update({
    ms365_access_token: d.access_token,
    ms365_refresh_token: d.refresh_token ?? profile.ms365_refresh_token,
    ms365_token_expiry: new Date(Date.now() + Number(d.expires_in ?? 3600) * 1000).toISOString(),
  }).eq("id", profile.id);
  return d.access_token as string;
}

async function getAppAccessToken(admin: any) {
  const cfg = await getMsConfig(admin);
  if (!cfg.clientId || !cfg.clientSecret || !cfg.tenant || cfg.tenant === "common") return null;
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const r = await fetch(`https://login.microsoftonline.com/${cfg.tenant}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  if (!r.ok) return null;
  const d = await r.json();
  return d.access_token as string;
}

async function listInboxDelegated(admin: any, profile: any, top: number): Promise<string[]> {
  let token = profile.ms365_access_token;
  const fetchList = async (tk: string) => fetch(
    `${GRAPH}/me/mailFolders/Inbox/messages?$select=id,receivedDateTime&$orderby=receivedDateTime desc&$top=${top}`,
    { headers: { Authorization: `Bearer ${tk}` } },
  );
  let r = await fetchList(token);
  if (r.status === 401) {
    const nt = await refreshToken(admin, profile);
    if (!nt) return [];
    token = nt;
    r = await fetchList(token);
  }
  if (!r.ok) return [];
  const d = await r.json();
  return (d.value ?? []).map((m: any) => m.id as string).filter(Boolean);
}

async function listInboxApp(appToken: string, mailbox: string, top: number): Promise<string[]> {
  const r = await fetch(
    `${GRAPH}/users/${encodeURIComponent(mailbox)}/mailFolders/Inbox/messages?$select=id,receivedDateTime&$orderby=receivedDateTime desc&$top=${top}`,
    { headers: { Authorization: `Bearer ${appToken}` } },
  );
  if (!r.ok) return [];
  const d = await r.json();
  return (d.value ?? []).map((m: any) => m.id as string).filter(Boolean);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: userData } = await admin.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
    if (!userData?.user) return json({ error: "Unauthorized" }, 401);
    const { data: isAdmin } = await admin.rpc("is_planipret_admin", { _user_id: userData.user.id });
    if (isAdmin !== true) return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const top = Math.min(Math.max(Number(body.top ?? 20), 1), 50);
    const maxBrokers = Math.min(Math.max(Number(body.max_brokers ?? 40), 1), 200);

    const { data: delegated } = await admin
      .from("planipret_profiles")
      .select("id, user_id, ms365_access_token, ms365_refresh_token, ms365_email, email")
      .not("ms365_access_token", "is", null)
      .not("user_id", "is", null)
      .limit(maxBrokers);

    let brokers = delegated ?? [];
    let mode: "delegated" | "application" = "delegated";
    let appToken: string | null = null;

    if (!brokers.length) {
      appToken = await getAppAccessToken(admin);
      if (!appToken) {
        return json({
          ok: false,
          error: "Aucun courtier n'a de token Microsoft 365 et l'Application Azure n'est pas configurée (MICROSOFT_TENANT_ID/CLIENT_ID/SECRET).",
          analyzed_brokers: 0, total_analyses: 0, errors: [], mode: "none",
        });
      }
      mode = "application";
      const { data: allBrokers } = await admin
        .from("planipret_profiles")
        .select("id, user_id, ms365_email, email")
        .not("user_id", "is", null)
        .or("ms365_email.not.is.null,email.not.is.null")
        .limit(maxBrokers);
      brokers = (allBrokers ?? []).filter((b: any) => b.ms365_email || b.email);
    }

    let totalAnalyses = 0;
    let analyzedBrokers = 0;
    const errors: any[] = [];
    const perBroker: any[] = [];

    for (const b of brokers) {
      try {
        const mailbox = (b as any).ms365_email || (b as any).email;
        const ids = mode === "application"
          ? await listInboxApp(appToken!, mailbox, top)
          : await listInboxDelegated(admin, b, top);
        if (!ids.length) {
          perBroker.push({ broker: mailbox, analyses: 0, note: "no inbox message" });
          continue;
        }
        analyzedBrokers++;
        let brokerAnalyses = 0;
        for (let i = 0; i < ids.length; i += 4) {
          const chunk = ids.slice(i, i + 4);
          await Promise.all(chunk.map(async (mid) => {
            const r = await fetch(`${SUPABASE_URL}/functions/v1/ava-email-analyzer`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                "x-ava-service": SUPABASE_SERVICE_ROLE_KEY,
              },
              body: JSON.stringify({ ms_message_id: mid, broker_user_id: (b as any).user_id, graph_mode: mode, mailbox }),
            });
            const jr = await r.json().catch(() => null);
            if (jr?.success) { totalAnalyses++; brokerAnalyses++; }
            else if (jr?.error) errors.push({ broker: mailbox, mid, error: jr.error });
          }));
        }
        perBroker.push({ broker: mailbox, analyses: brokerAnalyses });
      } catch (e) {
        errors.push({ broker: (b as any).ms365_email || (b as any).email, error: (e as Error).message });
      }
    }

    return json({
      ok: true,
      mode,
      analyzed_brokers: analyzedBrokers,
      total_analyses: totalAnalyses,
      brokers_scanned: brokers.length,
      per_broker: perBroker.slice(0, 30),
      errors: errors.slice(0, 20),
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
