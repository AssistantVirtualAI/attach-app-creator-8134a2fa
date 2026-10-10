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
  commissionGet,
  summarize,
  paidAnalytics,
  paidFlags,
  normalizePendingRow,
  institutionLabel,
  collectPaidDeposits,
  PENDING_COMMISSION_PATH,
  type CommissionDepositRow,
} from "../_shared/commission-reports.ts";
import { getMaestroAdminAccessToken } from "../_shared/maestro-admin-token.ts";
import { resolveCommissionScope } from "../_shared/commission-scope.ts";
import { validateCommissionOutput } from "../_shared/commission-validation.ts";

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

const PROFILE_FIELDS = "id, user_id, role, full_name, email, login_email, ms365_email, maestro_broker_id, maestro_telecom_user_id, maestro_connected";

function normalizeEmail(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  return /.+@.+\..+/.test(email) ? email : null;
}

/**
 * Resolve the signed-in broker first by Supabase user id, then by the exact
 * Microsoft/portal email recorded on an older profile.  The fallback is
 * read-only and only accepts one exact profile match, so it cannot turn an
 * arbitrary Microsoft address into access to another broker's commissions.
 */
async function findProfileForAuthenticatedUser(admin: any, user: any) {
  const { data: direct } = await admin
    .from("planipret_profiles")
    .select(PROFILE_FIELDS)
    .or(`user_id.eq.${user.id},id.eq.${user.id}`)
    .maybeSingle();
  if (direct) return direct;

  const email = normalizeEmail(user?.email);
  if (!email) return null;
  const matches = new Map<string, any>();
  for (const field of ["email", "login_email", "ms365_email"]) {
    const { data }: { data: any[] | null } = await admin
      .from("planipret_profiles")
      .select(PROFILE_FIELDS)
      .ilike(field, email)
      .limit(3);
    for (const profile of (data ?? []) as any[]) {
      if (String(profile?.[field] ?? "").trim().toLowerCase() === email && profile?.id) {
        matches.set(String(profile.id), profile);
      }
    }
  }
  return matches.size === 1 ? [...matches.values()][0] : null;
}

/**
 * Existing Capacitor clients turn any non-2xx Edge response into the generic
 * "Edge Function returned a non-2xx status code".  Once authentication has
 * succeeded, expected account and Maestro failures use this 200 contract so
 * the app can display an actionable French message instead of hiding it.
 */
function applicationError(error: string, message: string, cid: string, extra: Record<string, unknown> = {}) {
  return json({ success: false, error, message, retryable: error === "maestro_error" || error === "internal_error", correlation_id: cid, ...extra }, 200, cid);
}


const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};


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
    const authenticatedUser = user;

    const profile = await findProfileForAuthenticatedUser(admin, authenticatedUser);

    if (!profile) return applicationError("profile_not_linked", "Votre compte connecté n'est pas encore associé à un profil courtier Planiprêt. Demandez à un administrateur de vérifier votre courriel Microsoft.", cid);
    const role = String(profile.role ?? "");
    if (role !== "admin" && role !== "broker") {
      return applicationError("forbidden", "Accès aux commissions réservé aux courtiers et administrateurs.", cid);
    }
    if (role === "admin") {
      const { data: allowedAdmin } = await admin.rpc("is_planipret_admin", { _user_id: authenticatedUser.id });
      if (allowedAdmin !== true) return applicationError("forbidden", "Accès administrateur aux commissions non autorisé.", cid);
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
    // A historical profile may be linked to the same authenticated Microsoft
    // address but retain its original Supabase user id where the OAuth token
    // is stored.  Use that profile owner only after exact email matching above.
    const maestroTokenOwnerId = String(profile.user_id ?? authenticatedUser.id);
    const ownToken = await getUserMaestroAccessToken(admin, maestroTokenOwnerId);
    const firmToken = role === "admin"
      ? await getMaestroAdminAccessToken()
      : { token: null, source: "none" as const };

    let resolvedUsersId: string | null =
      profile.maestro_broker_id != null ? String(profile.maestro_broker_id) : null;
    if (!resolvedUsersId && ownToken) {
      const env = getMaestroOAuthEnv();
      const identity = await fetchMaestroUserProfile(env, ownToken);
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
        return applicationError("broker_id_unresolved", "Impossible de résoudre votre identifiant Maestro. Reconnectez votre compte Maestro.", cid);
      }
      filters.users_id = resolvedUsersId;
    }

    const scopeError = (error: "broker_id_unresolved" | "maestro_not_connected" | "admin_scope_unavailable") => {
      const messages = {
        broker_id_unresolved: "Impossible de résoudre votre identifiant Maestro. Reconnectez votre compte Maestro.",
        maestro_not_connected: "Votre compte Maestro n'est pas connecté. Reconnectez-le dans Réglages › Connexions.",
        admin_scope_unavailable: "La vue « Tous les courtiers » requiert un accès Maestro administrateur. Votre vue personnelle reste disponible.",
      };
      return applicationError(error, messages[error], cid);
    };

    // ---- Institutions ----------------------------------------------------
    if (action === "institutions") {
      const scope = resolveCommissionScope({
        role: role as "admin" | "broker",
        action,
        requestedUsersId: filters.users_id,
        ownUsersId: resolvedUsersId,
        ownToken,
        firmToken: firmToken.token,
      });
      if (!scope.ok) return scopeError(scope.error);
      const r = await commissionGet("/api/main/financial-institutions", scope.token, cid);
      if (!r.ok) return upstream(r, cid);
      const list = Array.isArray(r.data?.data) ? r.data.data : Array.isArray(r.data) ? r.data : [];
      return json({
        ok: true,
        institutions: list.map((i: any) => ({ id: i?.id ?? i?.financial_inst_id ?? null, label: institutionLabel(i) }))
          .filter((i: any) => i.id != null),
        correlation_id: cid,
      }, 200, cid);
    }

    // ---- Agents (admin: tous ; broker: soi-même + son équipe, filtré par Maestro) ----
    if (action === "agents") {
      const scope = resolveCommissionScope({
        role: role as "admin" | "broker",
        action,
        requestedUsersId: filters.users_id,
        ownUsersId: resolvedUsersId,
        ownToken,
        firmToken: firmToken.token,
      });
      if (!scope.ok) return scopeError(scope.error);
      const r = await commissionGet("/api/main/commissions/reports/agents", scope.token, cid);
      if (!r.ok) return upstream(r, cid);
      const list = Array.isArray(r.data?.data) ? r.data.data : Array.isArray(r.data) ? r.data : [];
      const pick = (a: any) =>
        [a?.agent_name, a?.name, a?.full_name,
          [a?.first_name, a?.last_name].filter(Boolean).join(" ").trim(),
          a?.target_name, a?.email]
          .map((v: any) => (v == null ? "" : String(v).trim()))
          .find((v: string) => v.length > 0) ?? "—";
      let agents = list
        .map((a: any) => ({ users_id: a?.users_id ?? a?.agent_name_id ?? a?.id ?? null, name: pick(a) }))
        .filter((a: any) => a.users_id != null);
      // Défense en profondeur : un broker ne voit jamais un courtier hors de sa portée.
      if (role === "broker" && resolvedUsersId) {
        agents = agents.filter((a: any) => String(a.users_id) === String(resolvedUsersId));
        if (!agents.length) agents = [{ users_id: Number(resolvedUsersId), name: String(profile.full_name ?? "Moi") }];
      } else if (role === "admin") {
        // Maestro ne renvoie que le propriétaire du jeton : on complète avec
        // les courtiers Planiprêt dont l'identifiant Maestro est déjà résolu.
        const { data: locals } = await admin
          .from("planipret_profiles")
          .select("full_name, email, maestro_broker_id")
          .not("maestro_broker_id", "is", null)
          .limit(500);
        const seen = new Set(agents.map((a: any) => String(a.users_id)));
        for (const p of locals ?? []) {
          const id = String((p as any).maestro_broker_id);
          if (!id || seen.has(id)) continue;
          seen.add(id);
          agents.push({ users_id: Number(id), name: String((p as any).full_name ?? (p as any).email ?? id) });
        }
        agents.sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), "fr"));
      }
      return json({ ok: true, agents, correlation_id: cid }, 200, cid);
    }



    // ---- Pending commissions -------------------------------------------
    // Courtier : son propre jeton. Admin : chaque courtier déjà connecté à
    // Maestro, lu côté serveur avec son propre jeton (lecture seule, jamais
    // renvoyé au client), avec tableau par courtier et filtre par agent.
    if (action === "pending") {
      const fetchPending = async (token: string, usersId: string | null) => {
        const raw: any[] = [];
        let upstreamSummary: unknown = null;
        let page = 1, lastPage = 1;
        while (page <= 25) {
          const qs = new URLSearchParams();
          if (usersId) qs.set("users_id", usersId);
          if (filters.financial_inst_id) qs.set("financial_inst_id", filters.financial_inst_id);
          if (filters.date_from && filters.date_to) {
            qs.set("date_from", filters.date_from.slice(0, 10));
            qs.set("date_to", filters.date_to.slice(0, 10));
          }
          qs.set("page", String(page));
          qs.set("per_page", "1000");
          const r = await commissionGet(`${PENDING_COMMISSION_PATH}?${qs}`, token, cid);
          if (!r.ok) return { ok: false as const, r };
          if (page === 1) upstreamSummary = r.data?.summary ?? null;
          const rows: any[] = Array.isArray(r.data?.data) ? r.data.data : [];
          raw.push(...rows);
          lastPage = Number(r.data?.meta?.last_page ?? 1);
          if (page >= lastPage || rows.length === 0) break;
          page += 1;
        }
        const rows = raw.map(normalizePendingRow);
        (globalThis as any).__ppMeta = { pages: page, raw: raw.length };
        const official = Array.isArray(upstreamSummary)
          ? (upstreamSummary as any[]).map((x) => ({ type: String(x?.type ?? ""), label: String(x?.label ?? x?.type ?? ""), amount: Number(x?.amount ?? 0) || 0 }))
          : null;
        return { ok: true as const, rows, official, truncated: lastPage > 25 };
      };
      const r2 = (n: number) => Math.round(n * 100) / 100;
      // Personal vs team split: a row belongs to the broker's own production when
      // Maestro's primary_broker_id equals the receiving broker; otherwise it is
      // an override earned on a team member's file (explicit field, never inferred).
      const split = (rows: CommissionDepositRow[], ownId: string | null) => {
        const mk = () => ({ amount: 0, contracts: new Map<string, number>() });
        const own = mk(); const teamAll = mk();
        const members = new Map<string, { id: string; name: string; amount: number; contracts: Map<string, number> }>();
        const add = (b: ReturnType<typeof mk>, r: any) => {
          b.amount += num(r.commission_amount ?? r.amount);
          const c = String(r.contract_id ?? r.number ?? "");
          if (c) b.contracts.set(c, Math.max(b.contracts.get(c) ?? 0, num(r.loan_amount ?? r.loan_amt ?? 0)));
        };
        for (const r of rows as any[]) {
          const pid = r.primary_broker_id != null ? String(r.primary_broker_id) : null;
          const receiver = ownId ?? (r.user_id != null ? String(r.user_id) : null);
          if (!pid || pid === receiver) { add(own, r); continue; }
          add(teamAll, r);
          const name = `${r.primary_broker_first_name ?? ""} ${r.primary_broker_last_name ?? ""}`.trim() || pid;
          const m = members.get(pid) ?? { id: pid, name, ...mk() };
          add(m as any, r); members.set(pid, m);
        }
        const out = (b: { amount: number; contracts: Map<string, number> }) => ({ amount: r2(b.amount), files: b.contracts.size, volume: r2([...b.contracts.values()].reduce((t, v) => t + v, 0)) });
        return {
          personal: out(own),
          team: out(teamAll),
          team_members: [...members.values()].map((m) => ({ id: m.id, name: m.name, ...out(m) })).sort((a, b) => b.amount - a.amount),
        };
      };
      // Aggregates per (commission type, share type) so the Maestro PDF report
      // (one type, one share type, row-level loan totals) can be reconciled.
      const breakdown = (rows: CommissionDepositRow[]) => {
        const g = new Map<string, { commission_type: string; split_type: string; rows: number; amount: number; loan: number }>();
        for (const r of rows as any[]) {
          const t = String(r.commission_type ?? "base");
          const s = `${r.primary_broker_id != null && String(r.primary_broker_id) !== String(r.user_id) ? "team" : "own"}|${String(r.status ?? "")}|${r.date_trans && !String(r.date_trans).startsWith("0000") ? "dated" : "undated"}|${num(r.loan_amount ?? r.loan_amt ?? 0) > 0 ? "loan" : "noloan"}`;
          const k = `${t}|${s}`;
          const b = g.get(k) ?? { commission_type: t, split_type: s, rows: 0, amount: 0, loan: 0 };
          b.rows += 1; b.amount += num(r.amount); b.loan += num(r.loan_amount ?? r.loan_amt ?? 0);
          g.set(k, b);
        }
        return [...g.values()].map((b) => ({ ...b, amount: r2(b.amount), loan: r2(b.loan) }));
      };
      const pack = (rows: CommissionDepositRow[], official: { type: string; label: string; amount: number }[] | null, truncated: boolean, ownId: string | null = null) => {
        const summary = summarize(rows, truncated);
        return { ...summary, official_by_type: official, official_total: official ? r2(official.reduce((t, x) => t + x.amount, 0)) : null, split: split(rows, ownId), breakdown: breakdown(rows), row_fields: rows[0] ? Object.keys(rows[0]).sort() : [], recon_meta: (globalThis as any).__ppMeta ?? null, recon_rows: (rows as any[]).filter((r) => String(r.commission_type) === "base").map((r) => [r.number, num(r.loan_amount ?? r.loan_amt ?? 0), num(r.amount), r.primary_broker_id, r.user_id, r.date_trans, r.commission_id, r.product_name, r.product_id, r.status, r.company]) };
      };

      if (role === "broker") {
        if (!ownToken) return scopeError("maestro_not_connected");
        const res = await fetchPending(ownToken, resolvedUsersId);
        if (!res.ok) return upstream(res.r, cid);
        const scope = { role, users_id: resolvedUsersId, mode: "own" };
        const summary = pack(res.rows, res.official, res.truncated, resolvedUsersId ? String(resolvedUsersId) : null);
        const validation = await validateCommissionOutput({ source: "pending_commissions", rows: res.rows, truncated: res.truncated, official: res.official, officialTotal: summary.official_total, scope });
        if (!validation.validated) return applicationError("commission_validation_blocked", "Les commissions en attente n'ont pas passé le contrôle final. La dernière version validée reste affichée.", cid, { validation });
        return json({ ok: true, summary, validation, source_identity: { source: "pending_commissions", endpoint: PENDING_COMMISSION_PATH, users_id: resolvedUsersId, generated_at: validation.checked_at }, scope, correlation_id: cid }, 200, cid);
      }

      // Admin : courtiers déjà authentifiés auprès de Maestro.
      let q = admin.from("planipret_profiles")
        .select("user_id, full_name, email, maestro_broker_id")
        .eq("maestro_connected", true)
        .not("maestro_broker_id", "is", null);
      if (filters.users_id) q = q.eq("maestro_broker_id", filters.users_id);
      const { data: profs } = await q;
      const seen = new Set<string>();
      const brokers = (profs ?? []).filter((p: any) => {
        const id = String(p.maestro_broker_id);
        if (seen.has(id) || !p.user_id) return false;
        seen.add(id); return true;
      });
      const table: any[] = [];
      const failed: string[] = [];
      const allRows: CommissionDepositRow[] = [];
      const officialAll = new Map<string, { type: string; label: string; amount: number }>();
      let anyTrunc = false;
      let idx = 0;
      const worker = async () => {
        while (idx < brokers.length) {
          const p: any = brokers[idx++];
          const name = String(p.full_name ?? p.email ?? p.maestro_broker_id);
          try {
            const token = await getUserMaestroAccessToken(admin, String(p.user_id));
            if (!token) { failed.push(name); continue; }
            const res = await fetchPending(token, String(p.maestro_broker_id));
            if (!res.ok) { failed.push(name); continue; }
            const s = pack(res.rows, res.official, res.truncated, String(p.maestro_broker_id));
            anyTrunc ||= res.truncated;
            allRows.push(...res.rows);
            for (const o of res.official ?? []) {
              const e = officialAll.get(o.type) ?? { ...o, amount: 0 };
              e.amount = r2(e.amount + o.amount); officialAll.set(o.type, e);
            }
            table.push({ users_id: Number(p.maestro_broker_id), name, amount: s.official_total ?? s.total_commission, files: s.deal_count, volume: s.total_loan_volume, personal: s.split.personal, team: s.split.team, team_members: s.split.team_members });
          } catch { failed.push(name); }
        }
      };
      await Promise.all(Array.from({ length: Math.min(5, brokers.length) }, worker));
      table.sort((a, b) => b.amount - a.amount);
      const official = officialAll.size ? [...officialAll.values()] : null;
      const scope = { role, users_id: filters.users_id ?? null, mode: filters.users_id ? "selected_broker" : "all_brokers" };
      const summary = pack(allRows, official, anyTrunc);
      const validation = await validateCommissionOutput({ source: "pending_commissions", rows: allRows, truncated: anyTrunc, official, officialTotal: summary.official_total, scope });
      if (!validation.validated) return applicationError("commission_validation_blocked", "Les commissions en attente n'ont pas passé le contrôle final. La dernière version validée reste affichée.", cid, { validation });
      log("pending admin brokers", table.length, "failed", failed.length);
      return json({
        ok: true,
        summary,
        validation,
        source_identity: { source: "pending_commissions", endpoint: PENDING_COMMISSION_PATH, users_id: filters.users_id ?? null, generated_at: validation.checked_at },
        brokers: table,
        failed_brokers: failed.length,
        scope,
        correlation_id: cid,
      }, 200, cid);
    }

    // ---- Source unique (aucun fan-out ni jeton d'un autre courtier) -------
    // La portée est strictement celle du jeton appelant, ou celle du jeton
    // administrateur Maestro explicitement configuré pour « Tous les courtiers ».
    // An authenticated Planiprêt administrator can read a selected connected
    // broker using that broker's server-only token, just like pending reports.
    // Maestro personal tokens must never be paired with a peer's users_id.
    let selectedToken: string | null = null;
    if (role === "admin" && filters.users_id) {
      const { data: selected } = await admin.from("planipret_profiles")
        .select("user_id")
        .eq("maestro_broker_id", filters.users_id)
        .eq("maestro_connected", true)
        .limit(1).maybeSingle();
      if (selected?.user_id) selectedToken = await getUserMaestroAccessToken(admin, String(selected.user_id));
    }
    const brokerSources: { token: string; label: string; user_id: string | null; usersId: string }[] = [];
    if (role === "admin" && !filters.users_id && !firmToken.token) {
      const { data: connected } = await admin.from("planipret_profiles")
        .select("user_id, full_name, maestro_broker_id")
        .eq("maestro_connected", true).not("maestro_broker_id", "is", null);
      const seenIds = new Set<string>();
      for (const broker of connected ?? []) {
        const id = String(broker.maestro_broker_id);
        if (!broker.user_id || seenIds.has(id)) continue;
        seenIds.add(id);
        const token = await getUserMaestroAccessToken(admin, String(broker.user_id));
        if (!token) return applicationError("maestro_not_connected", "Un compte courtier doit être reconnecté à Maestro. Le total du cabinet est indisponible; sélectionnez un courtier pour consulter ses déboursés.", cid);
        brokerSources.push({ token, label: String(broker.full_name ?? id), user_id: String(broker.user_id), usersId: id });
      }
    }
    const firstBroker = brokerSources[0];
    const reportScope = firstBroker
      ? { ok: true as const, token: firstBroker.token, usersId: null, mode: "all_brokers" as const }
      : selectedToken && filters.users_id
      ? { ok: true as const, token: selectedToken, usersId: filters.users_id, mode: "selected_broker" as const }
      : resolveCommissionScope({
      role: role as "admin" | "broker",
      action,
      requestedUsersId: filters.users_id,
      ownUsersId: resolvedUsersId,
      ownToken,
      firmToken: firmToken.token,
    });
    if (!reportScope.ok) return scopeError(reportScope.error);
    const activeReportScope: Extract<typeof reportScope, { ok: true }> = reportScope;

    type Src = { token: string; label: string; user_id: string | null; usersId?: string };
    const failures: { broker: string; status: number; message: string }[] = [];
    let coverage = { connected: 1, total: 1 };

    async function collectSources(): Promise<Src[]> {
      if (brokerSources.length) {
        coverage = { connected: brokerSources.length, total: brokerSources.length };
        return brokerSources;
      }
      if (activeReportScope.usersId) filters.users_id = activeReportScope.usersId;
      else delete filters.users_id;
      return [{
        token: activeReportScope.token,
        label: activeReportScope.mode === "own" ? String(profile.full_name ?? profile.email ?? "moi") : "Planiprêt",
        user_id: activeReportScope.mode === "own" ? authenticatedUser.id : null,
      }];
    }

    /** Parcourt toutes les pages de dépôts pour un jeton donné. */
    async function fetchAllDeposits(src: Src, _single: boolean) {
      return collectPaidDeposits(src.token, { ...filters, ...(src.usersId ? { users_id: src.usersId } : {}) }, cid);
    }

    async function collectPaidSources(sources: Src[]) {
      const results: Awaited<ReturnType<typeof fetchAllDeposits>>[] = [];
      for (let start = 0; start < sources.length; start += 5) {
        results.push(...await Promise.all(sources.slice(start, start + 5).map((src) => fetchAllDeposits(src, true))));
      }
      return results;
    }

    // ---- Deposits (agrégé pour les admins, passthrough sinon) -------------
    if (action === "deposits") {
      const sources = await collectSources();
      const single = sources.length === 1;
      const merged: CommissionDepositRow[] = [];
      let truncated = false;
      for (const res of await collectPaidSources(sources)) {
        if (res.fatal) return upstream(res.fatal, cid);
        merged.push(...res.rows);
        truncated = truncated || res.truncated;
      }
      const validationScope = { role, users_id: filters.users_id ?? null, mode: activeReportScope.mode };
      const validationSummary = summarize(merged, truncated);
      const validation = await validateCommissionOutput({ source: "paid_deposits", rows: merged, truncated, summary: validationSummary, scope: validationScope });
      if (!validation.validated) return applicationError("commission_validation_blocked", "Les commissions déboursées n'ont pas passé le contrôle final. La dernière version validée reste affichée.", cid, { validation });
      merged.sort((a, b) => String(b.date_trans ?? "").localeCompare(String(a.date_trans ?? "")));
      const perPage = Number(filters.per_page ?? 50);
      const pageNo = Number(filters.page ?? 1);
      const slice = merged.slice((pageNo - 1) * perPage, pageNo * perPage);
      log("deposits", slice.length, "of", merged.length, "from", sources.length, "tokens");
      return json({
        ok: true,
        rows: slice,
        pagination: {
          page: pageNo,
          per_page: perPage,
          total: merged.length,
          last_page: Math.max(1, Math.ceil(merged.length / perPage)),
        },
        truncated,
        validation,
        source_identity: { source: "paid_deposits", endpoint: "/api/main/commissions/reports/deposits", users_id: filters.users_id ?? null, generated_at: validation.checked_at },
        coverage,
        sources: { queried: sources.length, failed: failures.length, failures: failures.slice(0, 10) },
        scope: { role, users_id: filters.users_id ?? null, mode: activeReportScope.mode },
        correlation_id: cid,
      }, 200, cid);
    }

    // ---- Par courtier (agrégat serveur sur toutes les pages) --------------
    if (action === "by_agent") {
      const buckets = new Map<string, {
        users_id: number | null; name: string; total: number; count: number; loan_volume: number;
      }>();
      let truncated = false;
      let scanned = 0;

      const sources = await collectSources();


      for (const result of await collectPaidSources(sources)) {
        if (result.fatal) return upstream(result.fatal, cid);
        truncated ||= result.truncated;
          for (const { row, unique_volume } of paidFlags(result.rows)) {
            if (!row.date_trans) continue;
            const deposit = row as unknown as CommissionDepositRow;
            const id = deposit.agent_name_id ?? null;
            const name = String(row.agent_name ?? deposit.target_name ?? "—").trim() || "—";
            const key = id != null ? `id:${id}` : `n:${name.toLowerCase()}`;
            const b = buckets.get(key) ?? { users_id: id, name, total: 0, count: 0, loan_volume: 0 };
            b.total += num(row.amount);
            b.loan_volume += unique_volume ? num(row.loan_amt) : 0;
            b.count += 1;
            buckets.set(key, b);
          }
          scanned += result.rows.length;
      }

      const agents = Array.from(buckets.values())
        .map((b) => ({ ...b, average: b.count ? b.total / b.count : 0 }))
        .sort((a, b) => b.total - a.total);

      log("by_agent", agents.length, "brokers over", scanned, "deposits from", sources.length, "tokens");
      return json({
        ok: true,
        agents,
        totals: {
          total: agents.reduce((s, a) => s + a.total, 0),
          count: agents.reduce((s, a) => s + a.count, 0),
          loan_volume: agents.reduce((s, a) => s + a.loan_volume, 0),
          brokers: agents.length,
        },
        truncated,
        scanned,
        coverage,
        sources: { queried: sources.length, failed: failures.length, failures: failures.slice(0, 10) },

        filters,
        scope: { role, users_id: filters.users_id ?? null, mode: activeReportScope.mode },
        correlation_id: cid,
      }, 200, cid);
    }


    // ---- Summary (agrégat serveur, multi-courtiers pour les admins) -------
    if (action === "summary" || action === "analytics") {
      const sources = await collectSources();
      const single = sources.length === 1;
      const all: CommissionDepositRow[] = [];
      let truncated = false, total = 0;
      for (const res of await collectPaidSources(sources)) {
        if (res.fatal) return upstream(res.fatal, cid);
        all.push(...res.rows);
        truncated = truncated || res.truncated;
        total += res.total;
      }

      const summary = summarize(all, truncated);
      const validationScope = { role, users_id: filters.users_id ?? null, mode: activeReportScope.mode };
      const validation = await validateCommissionOutput({ source: "paid_deposits", rows: all, truncated, summary, scope: validationScope });
      if (!validation.validated) return applicationError("commission_validation_blocked", "Les commissions déboursées n'ont pas passé le contrôle final. La dernière version validée reste affichée.", cid, { validation });
      if (action === "analytics") return json({ ok: true, analytics: paidAnalytics(all), validation, source_identity: { source: "paid_deposits", endpoint: "/api/main/commissions/reports/deposits", users_id: filters.users_id ?? null, generated_at: validation.checked_at }, truncated, scope: validationScope }, 200, cid);
      // Paid split: Maestro's target_name is the broker who carried the file.
      let paid_split: unknown = null;
      try {
        let owner: string | null = activeReportScope.mode === "own" ? String(profile.full_name ?? "") : null;
        if (!owner && filters.users_id) {
          const { data: op } = await admin.from("planipret_profiles").select("full_name").eq("maestro_broker_id", String(filters.users_id)).limit(1).maybeSingle();
          owner = (op as any)?.full_name ?? null;
        }
        const norm = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
        if (owner) {
          const o = norm(owner);
          const mk = () => ({ amount: 0, files: new Set<string>(), volume: 0 });
          const own = mk(), team = mk();
          const mem = new Map<string, { name: string; b: ReturnType<typeof mk> }>();
          for (const { row: r, unique_volume, unique_deal } of paidFlags(all)) {
            if (!r.date_trans) continue;
            const target = (r as unknown as CommissionDepositRow).target_name;
            const t = norm(target);
            const b = !t || t === o ? own : team;
            const amt = num(r.amount); const n = String(r.number ?? "");
            const vol = unique_volume ? num(r.loan_amt) : 0;
            const apply = (x: ReturnType<typeof mk>) => { x.amount += amt; if (n && unique_deal) x.files.add(n); x.volume += vol; };
            apply(b);
            if (b === team) { const m = mem.get(t) ?? { name: String(target).trim(), b: mk() }; apply(m.b); mem.set(t, m); }
          }
          const out = (x: ReturnType<typeof mk>) => ({ amount: Math.round(x.amount * 100) / 100, files: x.files.size, volume: Math.round(x.volume * 100) / 100 });
          paid_split = { personal: out(own), team: out(team), team_members: [...mem.entries()].map(([id, m]) => ({ id, name: m.name, ...out(m.b) })).sort((a, b) => b.amount - a.amount) };
        }
      } catch { paid_split = null; }
      log("summary rows", all.length, "total", summary.total_commission, "from", sources.length, "tokens");
      return json({
        ok: true,
        summary,
        validation,
        source_identity: { source: "paid_deposits", endpoint: "/api/main/commissions/reports/deposits", users_id: filters.users_id ?? null, generated_at: validation.checked_at },
        analytics: paidAnalytics(all),
        paid_split,
        total_available: total,
        coverage,
        sources: { queried: sources.length, failed: failures.length, failures: failures.slice(0, 10) },
        scope: { role, users_id: filters.users_id ?? null, mode: activeReportScope.mode },
        filters,
        correlation_id: cid,
      }, 200, cid);
    }


    return applicationError("unknown_action", `Action inconnue: ${action}`, cid);
  } catch (e) {
    console.error(`[commission-reports][${cid}] fatal`, e);
    return applicationError("internal_error", "Le rapport de commissions est temporairement indisponible. Réessayez dans un instant.", cid);
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
    return applicationError(
      "maestro_error",
      map[r.status] ?? "Maestro a retourné une erreur pour ce rapport de commissions.",
      cid,
      { upstream_status: r.status },
    );
  }
});
