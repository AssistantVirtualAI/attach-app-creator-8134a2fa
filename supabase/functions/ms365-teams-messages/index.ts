// ms365-teams-messages — GET messages d'un chat/canal ou POST envoi.
// Auth: JWT courtier.
// Body:
//   GET  { action:"list", chat_id?, team_id?, channel_id?, top? }
//   POST { action:"send", chat_id?, team_id?, channel_id?, content, contentType?:"text"|"html" }
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const GRAPH = "https://graph.microsoft.com/v1.0";
const j = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function getMsConfig(admin: any) {
  const { data } = await admin.from("planipret_integration_secrets").select("config").eq("provider", "microsoft").maybeSingle();
  const c = (data?.config ?? {}) as Record<string, string>;
  return {
    clientId: c.client_id ?? Deno.env.get("MICROSOFT_CLIENT_ID") ?? "",
    clientSecret: c.client_secret ?? Deno.env.get("MICROSOFT_CLIENT_SECRET") ?? "",
    tenant: c.tenant_id ?? Deno.env.get("MICROSOFT_TENANT_ID") ?? "common",
  };
}
async function refreshToken(admin: any, profile: any) {
  const cfg = await getMsConfig(admin);
  if (!profile.ms365_refresh_token) return null;
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "refresh_token",
    refresh_token: profile.ms365_refresh_token,
    scope: "openid profile email offline_access User.Read User.ReadBasic.All Mail.ReadWrite Mail.Send MailboxSettings.Read Calendars.ReadWrite Chat.Read Chat.ReadBasic Chat.ReadWrite Channel.ReadBasic.All ChannelMessage.Read.All ChannelMessage.Send Team.ReadBasic.All Organization.Read.All Application.Read.All",
  });
  const r = await fetch(`https://login.microsoftonline.com/${cfg.tenant}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  if (!r.ok) return null;
  const d = await r.json();
  await admin.from("planipret_profiles").update({
    ms365_access_token: d.access_token,
    ms365_refresh_token: d.refresh_token ?? profile.ms365_refresh_token,
    ms365_scopes: d.scope ?? "openid profile email offline_access User.Read User.ReadBasic.All Mail.ReadWrite Mail.Send MailboxSettings.Read Calendars.ReadWrite Chat.Read Chat.ReadBasic Chat.ReadWrite Channel.ReadBasic.All ChannelMessage.Read.All ChannelMessage.Send Team.ReadBasic.All Organization.Read.All Application.Read.All",
    ms365_token_expiry: new Date(Date.now() + (Number(d.expires_in ?? 3600)) * 1000).toISOString(),
  }).eq("id", profile.id);
  return d.access_token as string;
}
async function graph(admin: any, profile: any, path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const r = await fetch(`${GRAPH}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${profile.ms365_access_token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (r.status === 401 && retry) {
    const t = await refreshToken(admin, profile);
    if (t) { profile.ms365_access_token = t; return graph(admin, profile, path, init, false); }
  }
  return r;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: claims } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    const userId = claims?.claims?.sub as string | undefined;
    if (!userId) return j({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const { action, chat_id, team_id, channel_id, content, contentType = "text", top = 30, user_ids, topic } = body ?? {};
    if (!action) return j({ error: "action_required" }, 400);

    const { data: profile } = await admin
      .from("planipret_profiles")
      .select("id, user_id, ms365_access_token, ms365_refresh_token")
      .eq("user_id", userId)
      .maybeSingle();
    if (!profile?.ms365_access_token) return j({ connected: false, messages: [], error: "ms365_not_connected" });

    // Create or reuse a chat (1:1 or group)
    if (action === "create_chat") {
      if (!Array.isArray(user_ids) || user_ids.length === 0) return j({ error: "user_ids_required" }, 400);
      const meRes = await graph(admin, profile, "/me?$select=id");
      const meBody = await meRes.json();
      if (!meRes.ok) return j({ error: "graph_me", detail: meBody }, meRes.status);
      const meId = meBody.id as string;
      const allIds = Array.from(new Set([meId, ...user_ids]));
      const isGroup = allIds.length > 2;
      const payload: any = {
        chatType: isGroup ? "group" : "oneOnOne",
        members: allIds.map((id: string) => ({
          "@odata.type": "#microsoft.graph.aadUserConversationMember",
          roles: ["owner"],
          "user@odata.bind": `https://graph.microsoft.com/v1.0/users('${id}')`,
        })),
      };
      if (isGroup && topic) payload.topic = topic;
      const cr = await graph(admin, profile, "/chats", { method: "POST", body: JSON.stringify(payload) });
      const cb = await cr.json();
      if (!cr.ok) return j({ error: "graph_create_chat", detail: cb }, cr.status);
      return j({ ok: true, chat_id: cb.id, chatType: cb.chatType, topic: cb.topic ?? null });
    }

    const scope = chat_id
      ? `/chats/${chat_id}/messages`
      : (team_id && channel_id)
        ? `/teams/${team_id}/channels/${channel_id}/messages`
        : null;
    if (!scope) return j({ error: "chat_id_or_team_channel_required" }, 400);

    if (action === "list") {
      const r = await graph(admin, profile, `${scope}?$top=${Math.min(50, Number(top) || 30)}`);
      const d = await r.json();
      if (!r.ok) return j({ error: "graph_list", detail: d }, r.status);
      const messages = (d.value ?? []).map((m: any) => ({
        id: m.id,
        from: m.from?.user?.displayName ?? m.from?.application?.displayName ?? "Unknown",
        createdAt: m.createdDateTime,
        contentType: m.body?.contentType,
        content: m.body?.content ?? "",
      }));
      return j({ messages });
    }

    if (action === "send") {
      if (!content) return j({ error: "content_required" }, 400);
      const r = await graph(admin, profile, scope, {
        method: "POST",
        body: JSON.stringify({ body: { contentType, content } }),
      });
      const d = await r.json();
      if (!r.ok) return j({ error: "graph_send", detail: d }, r.status);
      return j({ ok: true, id: d.id });
    }

    return j({ error: "unknown_action" }, 400);
  } catch (e: any) {
    console.error("[ms365-teams-messages]", e);
    return j({ error: e?.message ?? "server_error" }, 500);
  }
});
