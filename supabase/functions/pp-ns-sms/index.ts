// pp-ns-sms — Proxy NS-API v2 SMS/Messages pour Planiprêt.
// AVA Planiprêt uniquement. Segmentation stricte par extension utilisateur.
//
// GET  ?action=threads              → Liste des sessions de messages (threads)
// GET  ?action=messages&thread_id=X → Messages d'un thread
// POST ?action=send  body { to, message, type? }  → Envoyer SMS/Chat
// GET  ?action=sms-numbers          → Numéros SMS assignés à l'utilisateur
//
// Sécurité : requirePlanipretBroker() vérifie :
//   1. JWT Supabase valide
//   2. Utilisateur membre de l'organisation Planiprêt (is_planipret_member)
//   3. Profil planipret_profiles avec extension et ns_domain
//   4. Bloque les utilisateurs Lemtel-only

import {
  corsHeaders,
  jsonResponse,
  requirePlanipretBroker,
  nsFetch,
} from "../_shared/planipret-ns.ts";
import {
  getMaestroTelecomConfig,
  isMaestroTelecomConfigured,
  maestroTelecomFetch,
  maestroTelecomMirror,
} from "../_shared/maestro-telecom.ts";


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const guard = await requirePlanipretBroker(req);
  if (guard instanceof Response) return guard;

  const { ctx, supabase } = guard;
  const url = new URL(req.url);

  // Parse body once (tolerant to invoke() which always POSTs JSON)
  let body: Record<string, any> = {};
  if (req.method !== "GET") {
    body = await req.json().catch(() => ({})) ?? {};
  }
  const qp = url.searchParams;
  const pick = (k: string) => body?.[k] ?? qp.get(k) ?? undefined;

  const action = (pick("action") as string) ?? "threads";
  const userBase = `/domains/${encodeURIComponent(ctx.nsDomain)}/users/${encodeURIComponent(ctx.extension)}`;

  try {
    if (action === "threads") {
      const limit = (pick("limit") as string) ?? "50";
      const res = await nsFetch(`${userBase}/messagesessions?limit=${limit}`, { method: "GET" });
      if (!res.ok) {
        const txt = await res.text();
        return jsonResponse({ error: "NS-API threads fetch failed", status: res.status, body: txt }, 502);
      }
      const raw = await res.json();
      const threads = Array.isArray(raw) ? raw : (raw?.messagesessions ?? raw?.data ?? []);

      // Best-effort Maestro inbox enrichment.
      let maestroInbox: any[] = [];
      if (ctx.maestroBrokerId) {
        try {
          const cfg = await getMaestroTelecomConfig(supabase);
          if (isMaestroTelecomConfigured(cfg)) {
            const r = await maestroTelecomFetch<any>(cfg, `/users/${encodeURIComponent(ctx.maestroBrokerId)}/inbox`);
            const list = Array.isArray(r.data) ? r.data : (r.data?.inbox ?? r.data?.threads ?? r.data?.data ?? []);
            if (Array.isArray(list)) maestroInbox = list;
          }
        } catch { /* ignore */ }
      }
      return jsonResponse({ ok: true, count: threads.length, threads, maestro_inbox: maestroInbox });
    }

    if (action === "messages") {
      const threadId = pick("thread_id") as string | undefined;
      if (!threadId) return jsonResponse({ error: "thread_id requis" }, 400);
      const limit = (pick("limit") as string) ?? "100";
      const res = await nsFetch(
        `${userBase}/messagesessions/${encodeURIComponent(threadId)}/messages?limit=${limit}`,
        { method: "GET" }
      );
      if (!res.ok) {
        const txt = await res.text();
        return jsonResponse({ error: "NS-API messages fetch failed", status: res.status, body: txt }, 502);
      }
      const raw = await res.json();
      const messages = Array.isArray(raw) ? raw : (raw?.messages ?? raw?.data ?? []);

      // Best-effort Maestro conversation enrichment (needs a phone hint).
      let maestroMessages: any[] = [];
      const phoneHint = pick("phone_number") as string | undefined;
      if (ctx.maestroBrokerId && phoneHint) {
        try {
          const cfg = await getMaestroTelecomConfig(supabase);
          if (isMaestroTelecomConfigured(cfg)) {
            const r = await maestroTelecomFetch<any>(
              cfg,
              `/users/${encodeURIComponent(ctx.maestroBrokerId)}/messages/with/${encodeURIComponent(phoneHint)}`,
            );
            const list = Array.isArray(r.data) ? r.data : (r.data?.messages ?? r.data?.data ?? []);
            if (Array.isArray(list)) maestroMessages = list;
          }
        } catch { /* ignore */ }
      }
      return jsonResponse({ ok: true, count: messages.length, messages, maestro_messages: maestroMessages });
    }


    if (action === "sms-numbers") {
      const res = await nsFetch(`${userBase}/smsnumbers`, { method: "GET" });
      if (!res.ok) {
        const txt = await res.text();
        return jsonResponse({ error: "NS-API SMS numbers fetch failed", status: res.status, body: txt }, 502);
      }
      const raw = await res.json();
      const numbers = Array.isArray(raw) ? raw : (raw?.smsnumbers ?? raw?.data ?? []);
      return jsonResponse({ ok: true, numbers });
    }

    if (action === "send") {
      const to = pick("to") as string | undefined;
      const message = pick("message") as string | undefined;
      const type = (pick("type") as string) ?? "sms";
      const thread_id = pick("thread_id") as string | undefined;
      let from = pick("from") as string | undefined;

      if (!to || !message) {
        return jsonResponse({ error: "to et message sont requis" }, 400);
      }

      // If no from was passed, auto-detect from the user's SMS numbers so NS
      // doesn't reject the request with "no source".
      if (!from && !thread_id) {
        try {
          const nres = await nsFetch(`${userBase}/smsnumbers`, { method: "GET" });
          if (nres.ok) {
            const nraw = await nres.json();
            const list = Array.isArray(nraw) ? nraw : (nraw?.smsnumbers ?? nraw?.data ?? []);
            const first = list?.[0];
            from = (typeof first === "string" && first) || first?.number || first?.phonenumber || first?.smsnumber || first?.did || undefined;
          }
        } catch (_) { /* ignore, NS will reject with a clear message */ }
      }

      const normalizedTo = String(to).replace(/[^\d+]/g, "");
      const destination = normalizedTo.startsWith("+")
        ? normalizedTo
        : `+${normalizedTo.replace(/^1?(\d{10})$/, "1$1")}`;
      const directBody: Record<string, unknown> = { type, destination, message, ...(from ? { from, source: from } : {}) };
      const domains = Array.from(new Set([ctx.nsDomain, "planipret.ca"].filter(Boolean)));
      const sendAttempts: Array<{ path: string; body: Record<string, unknown> }> = [];
      for (const domain of domains) {
        const domainBase = `/domains/${encodeURIComponent(domain)}`;
        const scopedUserBase = `${domainBase}/users/${encodeURIComponent(ctx.extension)}`;
        if (thread_id) {
          sendAttempts.push(
            { path: `${scopedUserBase}/messagesessions/${encodeURIComponent(thread_id)}/messages`, body: { message, type, destination, ...(from ? { from, source: from } : {}) } },
            { path: `${scopedUserBase}/messagesessions/messages`, body: directBody },
            { path: `${domainBase}/messagesessions/${encodeURIComponent(thread_id)}/messages`, body: { ...directBody, user: ctx.extension, extension: ctx.extension } },
          );
        } else {
          sendAttempts.push(
            { path: `${scopedUserBase}/messagesessions/messages`, body: directBody },
            { path: `${scopedUserBase}/messagesessions`, body: directBody },
            { path: `${domainBase}/messagesessions/messages`, body: { ...directBody, user: ctx.extension, extension: ctx.extension } },
            { path: `${domainBase}/messagesessions`, body: { ...directBody, user: ctx.extension, extension: ctx.extension } },
          );
        }
      }

      let res: Response | null = null;
      let result: any = null;
      let lastText = "";
      let lastPath = "";
      for (const attempt of sendAttempts) {
        lastPath = attempt.path;
        res = await nsFetch(attempt.path, { method: "POST", body: JSON.stringify(attempt.body) });
        lastText = await res.text();
        try { result = lastText ? JSON.parse(lastText) : {}; } catch { result = { raw: lastText }; }
        if (res.ok) break;
        const msg = typeof result === "object" ? String(result?.message ?? result?.error ?? lastText) : lastText;
        if (!/destination/i.test(msg) && res.status !== 404) break;
      }
      if (!res || !res.ok) {
        const status = res?.status ?? 502;
        console.error("[pp-ns-sms] NS send failed", status, lastPath, lastText);
        return jsonResponse(
          { ok: false, error: `Envoi SMS refusé (${status})`, status, body: lastText, from, to: destination, endpoint: lastPath },
          200,
        );
      }

      try {
        await supabase
          .from("planipret_phone_messages")
          .insert({
            user_id: ctx.profileId,
            direction: "outbound",
            to_number: destination,
            from_number: from ?? ctx.extension,
            body: message,
            type,
            ns_thread_id: thread_id ?? result?.messagesession_id ?? null,
            sent_at: new Date().toISOString(),
          });
      } catch (logErr) {
        console.warn("[pp-ns-sms] log insert failed (non-fatal):", logErr);
      }

      // Mirror the outbound SMS to Maestro Telecom — fire-and-forget with
      // exponential-backoff retry + sync-log so an outage there never fails
      // the NS-API send.
      if (ctx.maestroBrokerId) {
        maestroTelecomMirror(supabase, `/users/${encodeURIComponent(ctx.maestroBrokerId)}/messages`, {
          method: "POST",
          body: { to_user_number: destination, message },
          action: "sms.send",
          userId: ctx.userId,
        });
      }

      return jsonResponse({ ok: true, result, from, to: destination });

    }

    return jsonResponse({ error: `Action inconnue: ${action}` }, 400);
  } catch (e) {
    console.error("[pp-ns-sms] Erreur:", e);
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
