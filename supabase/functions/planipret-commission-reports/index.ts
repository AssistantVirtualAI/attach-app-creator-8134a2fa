// planipret-commission-reports — secure gateway to the OFFICIAL Planiprêt
// Commission Reports API for the mobile app and the AVA tools.
//
// Actions: deposits | agents | institutions | summary | preference
// Read-only against Maestro. The broker's OAuth bearer NEVER leaves the server.
//
// Scoping rules:
//   - role "broker": always forced to their own resolved Maestro users_id.
//   - role "admin":  may pass an explicit users_id, or omit it for all brokers.
// Any other role is rejected with 403.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  getMaestroOAuthEnv,
  getUserMaestroAccessToken,
  fetchMaestroUserProfile,
  extractMaestroBrokerId,
} from "../_shared/maestro-oauth.ts";
import {
  normalizeFilters,
  buildDepositQuery,
  commissionGet,
  summarize,
  institutionLabel,
  type CommissionDepositRow,
} from "../_shared/commission-reports.ts";

const json = (body: unknown, status = 200, cid?: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(cid ? { "X-Correlation-Id": cid } : {}),
    },
  });

const SUMMARY_MAX_PAGES = 10; // 10 × 200 = 2000 rows max per summary

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const cid = crypto.randomUUID().slice(0, 8);
  const log = (...a: unknown[]) => console.log(`[commission-reports][${cid}]`, ...a);

  try {
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, cid);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // ---- Auth ----------------------------------------------------------
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return json({ error: "unauthorized", message: "Authentification requise." }, 401, cid);
    const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
    const user = userRes?.user;
    if (userErr || !user) return json({ error: "unauthorized", message: "Session invalide." }, 401, cid);

    const { data: profile } = await admin
      .from("planipret_profiles")
      .select("id, user_id, role, full_name, email, maestro_broker_id, maestro_telecom_user_id, maestro_connected")
      .or(`user_id.eq.${user.id},id.eq.${user.id}`)
      .maybeSingle();

    if (!profile) return json({ error: "forbidden", message: "Profil Planiprêt introuvable." }, 403, cid);
    const role = String(profile.role ?? "");
    if (role !== "admin" && role !== "broker") {
      return json({ error: "forbidden", message: "Accès aux commissions réservé aux courtiers et administrateurs." }, 403, cid);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "summary");

    // ---- Preference (no Maestro call needed) ----------------------------
    if (action === "preference") {
      const { data: settings } = await admin
        .from("planipret_settings")
        .select("id, preferences")
        .eq("user_id", user.id)
        .maybeSingle();
      const prefs = (settings?.preferences ?? {}) as Record<string, unknown>;

      if (body?.set === undefined) {
        return json({ ok: true, ava_include_commissions: prefs.ava_include_commissions === true }, 200, cid);
      }
      const next = body.set === true;
      const merged = { ...prefs, ava_include_commissions: next };
      if (settings?.id) {
        await admin.from("planipret_settings").update({ preferences: merged }).eq("id", settings.id);
      } else {
        await admin.from("planipret_settings").insert({ user_id: user.id, preferences: merged });
      }
      log("preference ava_include_commissions =", next);
      return json({ ok: true, ava_include_commissions: next }, 200, cid);
    }

    // ---- Maestro token + identity ---------------------------------------
    const token = await getUserMaestroAccessToken(admin, user.id);
    if (!token) {
      return json({
        error: "maestro_not_connected",
        message: "Votre compte Maestro n'est pas connecté. Reconnectez-le dans Réglages › Connexions.",
      }, 409, cid);
    }

    let resolvedUsersId: string | null =
      profile.maestro_broker_id != null ? String(profile.maestro_broker_id) : null;
    if (!resolvedUsersId) {
      const env = getMaestroOAuthEnv();
      const identity = await fetchMaestroUserProfile(env, token);
      resolvedUsersId = extractMaestroBrokerId(identity);
      if (resolvedUsersId) {
        await admin.from("planipret_profiles")
          .update({ maestro_broker_id: resolvedUsersId })
          .eq("id", profile.id);
      }
    }

    // ---- Filters (allowlist) --------------------------------------------
    const { filters, errors } = normalizeFilters(body?.filters ?? body);
    if (Object.keys(errors).length) {
      return json({ error: "validation_error", fields: errors }, 422, cid);
    }

    // Broker scoping is server-enforced: they can never widen the scope.
    if (role === "broker") {
      if (!resolvedUsersId) {
        return json({
          error: "broker_id_unresolved",
          message: "Impossible de résoudre votre identifiant Maestro. Reconnectez votre compte Maestro.",
        }, 409, cid);
      }
      filters.users_id = resolvedUsersId;
    }

    // ---- Institutions ----------------------------------------------------
    if (action === "institutions") {
      const r = await commissionGet("/api/main/financial-institutions", token, cid);
      if (!r.ok) return upstream(r, cid);
      const list = Array.isArray(r.data?.data) ? r.data.data : Array.isArray(r.data) ? r.data : [];
      return json({
        ok: true,
        institutions: list.map((i: any) => ({ id: i?.id ?? i?.financial_inst_id ?? null, label: institutionLabel(i) }))
          .filter((i: any) => i.id != null),
        correlation_id: cid,
      }, 200, cid);
    }

    // ---- Agents ----------------------------------------------------------
    if (action === "agents") {
      if (role !== "admin") {
        return json({ error: "forbidden", message: "Liste des courtiers réservée aux administrateurs." }, 403, cid);
      }
      const r = await commissionGet("/api/main/commissions/reports/agents", token, cid);
      if (!r.ok) return upstream(r, cid);
      const list = Array.isArray(r.data?.data) ? r.data.data : Array.isArray(r.data) ? r.data : [];
      return json({
        ok: true,
        agents: list.map((a: any) => ({
          users_id: a?.users_id ?? a?.id ?? null,
          name: String(a?.agent_name ?? a?.name ?? "—"),
        })).filter((a: any) => a.users_id != null),
        correlation_id: cid,
      }, 200, cid);
    }

    // ---- Deposits (paginated passthrough) --------------------------------
    if (action === "deposits") {
      const qs = buildDepositQuery(filters);
      const r = await commissionGet(`/api/main/commissions/reports/deposits?${qs}`, token, cid);
      if (!r.ok) return upstream(r, cid);
      const rows: CommissionDepositRow[] = Array.isArray(r.data?.data) ? r.data.data : [];
      const meta = r.data?.meta ?? {};
      log("deposits", rows.length, "of", meta.total ?? "?", `${r.durationMs}ms`);
      return json({
        ok: true,
        rows,
        pagination: {
          page: Number(meta.current_page ?? filters.page ?? 1),
          per_page: Number(meta.per_page ?? filters.per_page ?? 50),
          total: Number(meta.total ?? rows.length),
          last_page: Number(meta.last_page ?? 1),
        },
        scope: { role, users_id: filters.users_id ?? null },
        correlation_id: cid,
      }, 200, cid);
    }

    // ---- Summary (server-side aggregation over all pages) -----------------
    if (action === "summary") {
      const all: CommissionDepositRow[] = [];
      let page = 1, lastPage = 1, truncated = false, total = 0;
      while (page <= SUMMARY_MAX_PAGES) {
        const qs = buildDepositQuery({ ...filters, page, per_page: 200 });
        const r = await commissionGet(`/api/main/commissions/reports/deposits?${qs}`, token, cid);
        if (!r.ok) return upstream(r, cid);
        const rows: CommissionDepositRow[] = Array.isArray(r.data?.data) ? r.data.data : [];
        all.push(...rows);
        const meta = r.data?.meta ?? {};
        lastPage = Number(meta.last_page ?? 1);
        total = Number(meta.total ?? all.length);
        if (page >= lastPage || rows.length === 0) break;
        page += 1;
      }
      if (page >= SUMMARY_MAX_PAGES && lastPage > SUMMARY_MAX_PAGES) truncated = true;

      const summary = summarize(all, truncated);
      log("summary rows", all.length, "total", summary.total_commission);
      return json({
        ok: true,
        summary,
        total_available: total,
        scope: { role, users_id: filters.users_id ?? null },
        filters,
        correlation_id: cid,
      }, 200, cid);
    }

    return json({ error: "unknown_action", message: `Action inconnue: ${action}` }, 400, cid);
  } catch (e) {
    console.error(`[commission-reports][${cid}] fatal`, e);
    return json({ error: "internal_error", message: (e as Error).message, correlation_id: cid }, 500, cid);
  }

  function upstream(r: { status: number; data: any }, cid: string) {
    const map: Record<number, string> = {
      401: "Session Maestro expirée. Reconnectez votre compte Maestro.",
      403: "Maestro refuse l'accès à ces rapports de commissions pour votre compte.",
      404: "Rapport de commissions introuvable dans Maestro.",
      422: "Filtres refusés par Maestro.",
      504: "Maestro n'a pas répondu à temps. Réessayez.",
    };
    console.warn(`[commission-reports][${cid}] upstream`, r.status, JSON.stringify(r.data)?.slice(0, 200));
    return json({
      error: "maestro_error",
      status: r.status,
      message: map[r.status] ?? "Maestro a retourné une erreur pour ce rapport de commissions.",
      details: r.data?.message ?? null,
      correlation_id: cid,
    }, r.status === 401 ? 409 : 502, cid);
  }
});
