// pp-ns-contacts — Proxy NS-API v2 Contacts pour Planiprêt.
// Accepte action via query (?action=) OU body { action }.
//   list      → contacts personnels
//   shared    → contacts partagés du domaine
//   directory → annuaire interne (extensions)
//   create    → créer un contact personnel (body: first_name, last_name, phone, email, company)
//   update    → maj (body: contact_id, …)
//   delete    → suppr (body: contact_id)

import {
  corsHeaders,
  jsonResponse,
  requirePlanipretBroker,
  nsFetch,
  AVA_ORG_ID,
} from "../_shared/planipret-ns.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const guard = await requirePlanipretBroker(req);
  if (guard instanceof Response) return guard;
  const { ctx, supabase } = guard;

  const url = new URL(req.url);
  let body: any = {};
  if (req.method !== "GET" && req.method !== "DELETE") {
    body = await req.json().catch(() => ({}));
  }
  const action = (body?.action ?? url.searchParams.get("action") ?? "list").toString();

  const userBase = `/domains/${encodeURIComponent(ctx.nsDomain)}/users/${encodeURIComponent(ctx.extension)}`;
  const domainBase = `/domains/${encodeURIComponent(ctx.nsDomain)}`;

  try {
    if (action === "list") {
      const limit = body?.limit ?? url.searchParams.get("limit") ?? "500";
      const res = await nsFetch(`${userBase}/contacts?limit=${limit}`, { method: "GET" });
      if (!res.ok) return jsonResponse({ error: "NS-API contacts fetch failed", status: res.status, body: await res.text() }, 502);
      const raw = await res.json();
      const contacts = Array.isArray(raw) ? raw : (raw?.contacts ?? raw?.data ?? []);
      return jsonResponse({ ok: true, count: contacts.length, contacts });
    }

    if (action === "shared") {
      const limit = body?.limit ?? url.searchParams.get("limit") ?? "500";
      const res = await nsFetch(`${domainBase}/contacts?limit=${limit}`, { method: "GET" });
      if (!res.ok) return jsonResponse({ error: "NS-API shared contacts fetch failed", status: res.status, body: await res.text() }, 502);
      const raw = await res.json();
      const contacts = Array.isArray(raw) ? raw : (raw?.contacts ?? raw?.data ?? []);
      return jsonResponse({ ok: true, count: contacts.length, contacts });
    }

    if (action === "directory") {
      const debug = body?.debug === true || url.searchParams.get("debug") === "1";
      const limit = body?.limit ?? url.searchParams.get("limit") ?? "500";
      const res = await nsFetch(`${domainBase}/users?limit=${encodeURIComponent(String(limit))}`, { method: "GET" });
      if (!res.ok) return jsonResponse({ error: "NS-API directory fetch failed", status: res.status, body: await res.text() }, 502);
      const raw = await res.json();
      const users = Array.isArray(raw) ? raw : (raw?.users ?? raw?.data ?? []);

      const extValues = users
        .map((u: any) => String(u.user ?? u.extension ?? u.uid ?? "").trim())
        .filter(Boolean);
      const { data: localExtRows } = extValues.length
        ? await supabase
          .from("pbx_extensions_real")
          .select("extension,directory_first_name,directory_last_name,directory_visible,directory_exten_visible,effective_cid_name,outbound_cid_name,description,voicemail_mail_to,do_not_disturb,enabled")
          .eq("organization_id", AVA_ORG_ID)
          .in("extension", extValues)
        : { data: [] as any[] };
      const localByExt = new Map((localExtRows ?? []).map((r: any) => [String(r.extension), r]));

      const extractName = (u: any) => {
        const first =
          u.directory_first_name ?? u.first_name ?? u.firstname ?? u["first-name"] ?? u.given_name ?? u.givenName ?? u.fname ?? "";
        const last =
          u.directory_last_name ?? u.last_name ?? u.lastname ?? u["last-name"] ?? u.family_name ?? u.familyName ?? u.surname ?? u.lname ?? "";
        const composed = `${first} ${last}`.trim();
        const display =
          u.name ?? u.display_name ?? u.displayName ?? u.full_name ?? u.fullName ?? u.caller_id_name ?? u.callerid_name ?? u.effective_cid_name ?? "";
        return { first, last, composed, display };
      };

      const extractPosition = (u: any) =>
        u.position ?? u.job_title ?? u.jobTitle ?? u.title ?? u.role_title ?? u.roleTitle ?? u.poste ?? u.department ?? null;

      // First pass — figure out who is missing a real name
      const initial = users.map((u: any) => ({
        u,
        ext: u.user ?? u.extension ?? u.uid,
        ...extractName(u),
        position: extractPosition(u),
      }));

      // Enrich in parallel (bounded concurrency) for users where name/poste is missing.
      const missing = initial.filter((x) => (!x.composed || !x.display || !x.position) && x.ext);
      const CONCURRENCY = 8;
      let idx = 0;
      const details = new Map<string, any>();
      async function worker() {
        while (idx < missing.length) {
          const i = idx++;
          const ext = missing[i].ext;
          try {
            const r = await nsFetch(`${domainBase}/users/${encodeURIComponent(ext)}`, { method: "GET" });
            if (r.ok) {
              const j = await r.json().catch(() => null);
              if (j) details.set(String(ext), Array.isArray(j) ? j[0] : (j?.user ?? j));
            }
          } catch (_) { /* ignore */ }
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, missing.length) }, worker));

      const directory = initial.map(({ u, ext, first, last, composed, display, position }) => {
        let f = first, l = last, d = display, c = composed;
        const detail = ext ? details.get(String(ext)) : null;
        const local = ext ? localByExt.get(String(ext)) : null;
        if (detail) {
          const ex = extractName(detail);
          f = f || ex.first;
          l = l || ex.last;
          d = d || ex.display;
          c = `${f} ${l}`.trim();
        }
        if (local) {
          f = local.directory_first_name || f;
          l = local.directory_last_name || l;
          d = d || local.effective_cid_name || local.outbound_cid_name || local.description || "";
          c = `${f} ${l}`.trim();
        }
        const name = (c || d || ext || "").toString();
        return {
          extension: ext,
          name,
          first_name: f || undefined,
          last_name: l || undefined,
          directory_first_name: f || undefined,
          directory_last_name: l || undefined,
          display_name: d || name,
          email: u.email ?? (detail?.email ?? local?.voicemail_mail_to ?? null),
          department: u.department ?? (detail?.department ?? null),
          position: position ?? (detail ? extractPosition(detail) : null),
          directory_visible: local?.directory_visible ?? u.directory_visible ?? true,
          directory_exten_visible: local?.directory_exten_visible ?? u.directory_exten_visible ?? true,
          presence: local?.enabled === false ? "offline" : local?.do_not_disturb ? "busy" : (u.presence ?? u.status ?? (detail?.presence ?? detail?.status ?? "unknown")),
        };
      }).filter((c) => c.directory_visible !== false);

      if (debug) {
        return jsonResponse({
          ok: true,
          count: directory.length,
          sample_raw: users.slice(0, 2),
          sample_detail: Array.from(details.entries()).slice(0, 2),
          directory,
        });
      }
      return jsonResponse({ ok: true, count: directory.length, directory });
    }

    if (action === "create") {
      const { first_name, last_name, phone, email, company } = body ?? {};
      if (!first_name && !last_name && !phone) {
        return jsonResponse({ error: "first_name, last_name ou phone requis" }, 400);
      }
      const res = await nsFetch(`${userBase}/contacts`, {
        method: "POST",
        body: JSON.stringify({ first_name, last_name, phone, email, company }),
      });
      if (!res.ok) return jsonResponse({ error: "NS-API create contact failed", status: res.status, body: await res.text() }, 502);
      const result = await res.json().catch(() => ({}));
      return jsonResponse({ ok: true, contact: result });
    }

    if (action === "update") {
      const { contact_id, ...fields } = body ?? {};
      if (!contact_id) return jsonResponse({ error: "contact_id requis" }, 400);
      const res = await nsFetch(`${userBase}/contacts/${encodeURIComponent(contact_id)}`, {
        method: "PUT",
        body: JSON.stringify(fields),
      });
      if (!res.ok) return jsonResponse({ error: "NS-API update contact failed", status: res.status, body: await res.text() }, 502);
      const result = await res.json().catch(() => ({}));
      return jsonResponse({ ok: true, contact: result });
    }

    if (action === "delete" || req.method === "DELETE") {
      const contactId = body?.contact_id ?? url.searchParams.get("contact_id");
      if (!contactId) return jsonResponse({ error: "contact_id requis" }, 400);
      const res = await nsFetch(`${userBase}/contacts/${encodeURIComponent(contactId)}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        return jsonResponse({ error: "NS-API delete contact failed", status: res.status, body: await res.text() }, 502);
      }
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: `Action inconnue: ${action}` }, 400);
  } catch (e) {
    console.error("[pp-ns-contacts] Erreur:", e);
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
