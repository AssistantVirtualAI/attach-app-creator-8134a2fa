import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const GRAPH = "https://graph.microsoft.com/v1.0";
const MS_SCOPE = "openid profile email offline_access User.Read User.ReadBasic.All User.Read.All Contacts.Read Contacts.ReadWrite People.Read Mail.ReadWrite Mail.Send MailboxSettings.Read Calendars.ReadWrite Chat.Read Chat.ReadBasic Chat.ReadWrite ChatMessage.Send Channel.ReadBasic.All ChannelMessage.Read.All ChannelMessage.Send Team.ReadBasic.All Organization.Read.All Application.Read.All";

async function getMsConfig(admin: any) {
  const [{ data: secret }, { data: cfg }] = await Promise.all([
    admin.from("planipret_integration_secrets").select("config").in("provider", ["microsoft", "ms365"]).limit(1).maybeSingle(),
    admin.from("planipret_integration_config").select("config_data").eq("integration_key", "ms365").maybeSingle(),
  ]);
  const c = { ...((cfg?.config_data ?? {}) as Record<string, string>), ...((secret?.config ?? {}) as Record<string, string>) };
  return {
    clientId: c.client_id ?? Deno.env.get("MICROSOFT_CLIENT_ID") ?? "",
    clientSecret: c.client_secret ?? Deno.env.get("MICROSOFT_CLIENT_SECRET") ?? "",
    tenant: c.tenant_id ?? Deno.env.get("MICROSOFT_TENANT_ID") ?? "common",
  };
}

async function refreshToken(admin: any, profile: any) {
  const cfg = await getMsConfig(admin);
  if (!profile.ms365_refresh_token) return null;
  if (!cfg.clientId || !cfg.clientSecret) return null;
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "refresh_token",
    refresh_token: profile.ms365_refresh_token,
    scope: MS_SCOPE,
  });
  const r = await fetch(`https://login.microsoftonline.com/${cfg.tenant}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  if (!r.ok) { console.error("MS refresh failed", await r.text()); return null; }
  const d = await r.json();
  await admin.from("planipret_profiles").update({
    ms365_access_token: d.access_token,
    ms365_refresh_token: d.refresh_token ?? profile.ms365_refresh_token,
    ms365_scopes: d.scope ?? profile.ms365_scopes ?? MS_SCOPE,
    ms365_token_expiry: new Date(Date.now() + Number(d.expires_in ?? 3600) * 1000).toISOString(),
  }).eq("id", profile.id);
  return d.access_token as string;
}

async function graph(admin: any, profile: any, path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = profile.ms365_access_token;
  const r = await fetch(`${GRAPH}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (r.status === 401 && retry) {
    const newToken = await refreshToken(admin, profile);
    if (newToken) { profile.ms365_access_token = newToken; return graph(admin, profile, path, init, false); }
  }
  return r;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    const body = await req.json();
    const { action, payload = {}, _user_id: bodyUserId } = body ?? {};

    // Trusted server-to-server call (service role) may pass _user_id in body.
    let userId: string | undefined;
    if (token && token === serviceKey && bodyUserId) {
      userId = String(bodyUserId);
    } else {
      const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
      const { data: claims } = await userClient.auth.getClaims(token);
      userId = claims?.claims?.sub;
    }
    if (!userId) return new Response(JSON.stringify({ success: false, error: "Unauthorized", code: 401 }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: profile } = await admin.from("planipret_profiles").select("id, user_id, full_name, ms365_access_token, ms365_refresh_token, ms365_scopes, ms365_token_expiry, ms365_email").eq("user_id", userId).maybeSingle();
    if (!profile?.ms365_access_token) {
      return new Response(JSON.stringify({ success: false, error: "Microsoft 365 non connecté pour ce courtier" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    switch (action) {
      case "connection_status": {
        return j({
          success: true,
          connected: !!profile?.ms365_access_token,
          email: profile?.ms365_email ?? null,
          scopes: profile?.ms365_scopes ?? null,
          expires_at: profile?.ms365_token_expiry ?? null,
        });
      }
      case "read_emails": {
        const top = Math.min(Number(payload.top ?? 25), 50);
        const filter = payload.folder === "unread" ? "&$filter=isRead%20eq%20false" : "";
        const r = await graph(admin, profile, `/me/messages?$top=${top}&$orderby=receivedDateTime%20desc&$select=id,subject,from,receivedDateTime,bodyPreview,isRead,hasAttachments,importance${filter}`);
        const d = await r.json();
        return j({ success: r.ok, emails: d.value ?? [], error: d?.error?.message, details: d?.error, code: r.status }, 200);
      }
      case "read_email_detail": {
        const id = String(payload.message_id ?? "");
        if (!id) return j({ success: false, error: "message_id required" }, 400);
        const r = await graph(admin, profile, `/me/messages/${encodeURIComponent(id)}?$select=id,subject,from,toRecipients,receivedDateTime,body,bodyPreview,hasAttachments,importance,conversationId`);
        const d = await r.json();
        return j({ success: r.ok, email: d }, r.ok ? 200 : 500);
      }
      case "send_email": {
        const to = Array.isArray(payload.to) ? payload.to : [payload.to].filter(Boolean);
        if (!to.length || !payload.subject || !payload.body) return j({ success: false, error: "to, subject, body requis" }, 400);
        const r = await graph(admin, profile, `/me/sendMail`, { method: "POST", body: JSON.stringify({ message: { subject: payload.subject, body: { contentType: "HTML", content: String(payload.body).replace(/\n/g, "<br/>" ) }, toRecipients: to.map((e: string) => ({ emailAddress: { address: e } })) }, saveToSentItems: true }) });
        const txt = await r.text().catch(() => "");
        return j({ success: r.ok, error: r.ok ? null : txt, code: r.status }, r.ok ? 200 : 500);
      }
      case "create_calendar_event": {
        if (!payload.subject || !payload.start || !payload.end) return j({ success: false, error: "subject, start, end requis" }, 400);
        const r = await graph(admin, profile, `/me/events`, { method: "POST", body: JSON.stringify({ subject: payload.subject, start: payload.start, end: payload.end, body: { contentType: "HTML", content: payload.body ?? "" }, attendees: (payload.attendees ?? []).map((e: string) => ({ emailAddress: { address: e }, type: "required" })), isOnlineMeeting: payload.isOnlineMeeting ?? true, onlineMeetingProvider: payload.onlineMeetingProvider ?? "teamsForBusiness" }) });
        const d = await r.json();
        return j({ success: r.ok, event_id: d.id, event: d, error: d?.error?.message, code: r.status }, r.ok ? 200 : 500);
      }
      case "list_calendar_events": {
        const start = payload.start ?? new Date().toISOString();
        const end = payload.end ?? new Date(Date.now() + 7 * 86400000).toISOString();
        const r = await graph(admin, profile, `/me/calendarView?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}&$orderby=start/dateTime&$top=${Math.min(Number(payload.top ?? 20), 50)}&$select=id,subject,bodyPreview,start,end,location,attendees,organizer,onlineMeeting,webLink,isOnlineMeeting`);
        const d = await r.json();
        return j({ success: r.ok, events: d.value ?? [], error: d?.error?.message, details: d?.error, code: r.status }, r.ok ? 200 : 500);
      }
      case "update_calendar_event": {
        const id = String(payload.event_id ?? "");
        if (!id) return j({ success: false, error: "event_id requis" }, 400);
        const patch: Record<string, unknown> = {};
        if (payload.subject) patch.subject = payload.subject;
        if (payload.start) patch.start = payload.start;
        if (payload.end) patch.end = payload.end;
        if (payload.body) patch.body = { contentType: "HTML", content: payload.body };
        if (payload.location) patch.location = { displayName: String(payload.location) };
        if (Array.isArray(payload.attendees)) patch.attendees = payload.attendees.map((e: string) => ({ emailAddress: { address: e }, type: "required" }));
        const r = await graph(admin, profile, `/me/events/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
        const d = await r.json().catch(() => ({}));
        return j({ success: r.ok, event: d, error: d?.error?.message, code: r.status }, r.ok ? 200 : 500);
      }
      case "delete_calendar_event": {
        const id = String(payload.event_id ?? "");
        if (!id) return j({ success: false, error: "event_id requis" }, 400);
        const r = await graph(admin, profile, `/me/events/${encodeURIComponent(id)}`, { method: "DELETE" });
        const txt = await r.text().catch(() => "");
        return j({ success: r.ok, error: r.ok ? null : txt, code: r.status }, r.ok ? 200 : 500);
      }
      case "reply_teams_message":
      case "send_teams_message": {
        const chatId = payload.chat_id;
        const teamId = payload.team_id;
        const channelId = payload.channel_id;
        const content = payload.content ?? payload.message;
        if (!content) return j({ success: false, error: "content requis" }, 400);
        const scope = chatId
          ? `/chats/${encodeURIComponent(chatId)}/messages`
          : (teamId && channelId)
            ? `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`
            : null;
        if (!scope) return j({ success: false, error: "chat_id ou team_id+channel_id requis" }, 400);
        const r = await graph(admin, profile, scope, { method: "POST", body: JSON.stringify({ body: { contentType: payload.contentType ?? "text", content } }) });
        const d = await r.json().catch(() => ({}));
        return j({ success: r.ok, message_id: d.id, error: d?.error?.message, details: d?.error, code: r.status }, r.ok ? 200 : 500);
      }
      case "daily_briefing": {
        const emailsR = await graph(admin, profile, `/me/messages?$top=5&$filter=isRead%20eq%20false&$select=subject,from,bodyPreview`);
        const emails = (await emailsR.json()).value ?? [];
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today.getTime() + 86400000);
        const eventsR = await graph(admin, profile, `/me/calendarView?startDateTime=${today.toISOString()}&endDateTime=${tomorrow.toISOString()}`);
        const events = (await eventsR.json()).value ?? [];

        const { data: ant } = await admin.from("planipret_integration_secrets").select("config").eq("provider", "anthropic").maybeSingle();
        const apiKey = (ant?.config as any)?.api_key ?? Deno.env.get("ANTHROPIC_API_KEY");
        let briefing = `Bonjour ${profile.full_name ?? ""}, voici votre résumé du ${today.toLocaleDateString("fr-CA")}. Vous avez ${emails.length} courriels non lus et ${events.length} rendez-vous aujourd'hui.`;
        if (apiKey) {
          const cr = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
            body: JSON.stringify({
              model: "claude-sonnet-4-5-20250929",
              max_tokens: 600,
              system: "Tu es un assistant pour courtier hypothécaire. Génère un briefing matinal court et professionnel en français.",
              messages: [{ role: "user", content: `Courtier: ${profile.full_name}\nDate: ${today.toLocaleDateString("fr-CA")}\nCourriels non lus: ${JSON.stringify(emails)}\nRendez-vous: ${JSON.stringify(events)}\n\nGénère un briefing oral de 3-4 phrases.` }],
            }),
          });
          if (cr.ok) { const cd = await cr.json(); briefing = cd.content?.[0]?.text ?? briefing; }
        }
        return j({ success: true, briefing_text: briefing, emails_count: emails.length, events_count: events.length });
      }
      case "search_contact": {
        const q = String(payload.query ?? "").trim();
        if (!q) return j({ success: false, error: "query requis" }, 400);
        const enc = encodeURIComponent(q);
        // /me/people uses relevance-ranked people (emails, colleagues, contacts).
        // /me/contacts covers the personal address book. Query both in parallel.
        const [peopleR, contactsR] = await Promise.all([
          graph(admin, profile, `/me/people?$search="${enc}"&$top=10&$select=displayName,scoredEmailAddresses,phones,jobTitle,companyName`),
          graph(admin, profile, `/me/contacts?$search="${enc}"&$top=10&$select=displayName,emailAddresses,mobilePhone,businessPhones,companyName`),
        ]);
        const pd = await peopleR.json().catch(() => ({}));
        const cd = await contactsR.json().catch(() => ({}));
        const people = (pd.value ?? []).map((p: any) => ({
          name: p.displayName,
          email: p.scoredEmailAddresses?.[0]?.address ?? null,
          phone: p.phones?.[0]?.number ?? null,
          job: p.jobTitle, company: p.companyName, source: "people",
        }));
        const contacts = (cd.value ?? []).map((c: any) => ({
          name: c.displayName,
          email: c.emailAddresses?.[0]?.address ?? null,
          phone: c.mobilePhone ?? c.businessPhones?.[0] ?? null,
          company: c.companyName, source: "contacts",
        }));
        return j({ success: peopleR.ok || contactsR.ok, results: [...people, ...contacts].filter(r => r.email || r.phone).slice(0, 15) });
      }
      default:
        return j({ success: false, error: "Action inconnue" }, 400);
    }

  } catch (e: any) {
    console.error("ms365-actions error", e);
    return new Response(JSON.stringify({ success: false, error: e?.message ?? "Erreur serveur", code: 0 }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
