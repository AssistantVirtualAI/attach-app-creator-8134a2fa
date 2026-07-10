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
} from "../_shared/planipret-ns.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const guard = await requirePlanipretBroker(req);
  if (guard instanceof Response) return guard;
  const { ctx } = guard;

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
      const res = await nsFetch(`${domainBase}/users?limit=500`, { method: "GET" });
      if (!res.ok) return jsonResponse({ error: "NS-API directory fetch failed", status: res.status, body: await res.text() }, 502);
      const raw = await res.json();
      const users = Array.isArray(raw) ? raw : (raw?.users ?? raw?.data ?? []);
      const directory = users.map((u: any) => {
        const first = u.first_name ?? u.firstname ?? u["first-name"] ?? "";
        const last = u.last_name ?? u.lastname ?? u["last-name"] ?? "";
        const composed = `${first} ${last}`.trim();
        const name = u.name ?? u.display_name ?? u.full_name ?? (composed || u.user);
        return {
          extension: u.user ?? u.extension ?? u.uid,
          name,
          first_name: first || undefined,
          last_name: last || undefined,
          email: u.email ?? null,
          department: u.department ?? null,
          presence: u.presence ?? u.status ?? "unknown",
        };
      });
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
