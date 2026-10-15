// Asynchronous Maestro commission sync.
//
// Runs in the background (cron or manual admin trigger), fans out over every
// broker — using the admin-scoped credential when Planiprêt has issued one,
// otherwise the broker's own OAuth token — and caches the deposits in
// `planipret_commission_live_cache`. Per-broker diagnostics (connected? exact
// failure reason?) land in `planipret_commission_sync_diag`.
//
// The dashboards then read the cache instantly instead of fanning out live.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getUserMaestroAccessToken } from "../_shared/maestro-oauth.ts";
import { buildDepositQuery, commissionGet, PENDING_COMMISSION_PATH, type CommissionDepositRow } from "../_shared/commission-reports.ts";
import { getMaestroAdminAccessToken } from "../_shared/maestro-admin-token.ts";
import { agentKey } from "../_shared/broker-identity.ts";
import { contentKeyed, decideChange, fastHash, stableJson } from "../_shared/commission-version.ts";
import { reviewCommissionDelta, shouldReview, type DeltaReview } from "../_shared/commission-delta-review.ts";
import { ensureBuckets } from "../_shared/commission-buckets.ts";

const MAX_PAGES = 15;
const PER_PAGE = 200;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const dedupeKey = (r: { number?: unknown; date_trans?: unknown; amount?: unknown; commission_type?: unknown }) =>
  [
    String(r.number ?? "").trim().toUpperCase(),
    String(r.date_trans ?? "").slice(0, 10),
    num(r.amount).toFixed(2),
    String(r.commission_type ?? "").trim().toLowerCase(),
  ].join("|");

/**
 * pg_cron cannot supply a user JWT. It instead sends the dedicated Vault
 * secret, which this service-role client verifies through a role-restricted
 * RPC. The comparison and the secret value never enter Edge code or logs.
 */
async function isInternalCron(admin: any, candidate: string): Promise<boolean> {
  if (candidate.length < 48 || candidate.length > 256) return false;
  const { data, error } = await admin.rpc("pp_verify_internal_trigger_secret", { _candidate: candidate });
  return !error && data === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const cid = crypto.randomUUID().slice(0, 8);
  const log = (...a: unknown[]) => console.log(`[live-sync][${cid}]`, ...a);

  // --- authorization: Vault-backed internal cron, or a signed-in admin -------
  let trigger = "cron";
  const internalSecret = req.headers.get("X-Planipret-Internal-Trigger")?.trim() ?? "";
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const chained = bearer === key; // self-chain between broker batches
  if (!chained && !(await isInternalCron(admin, internalSecret))) {
    const authz = req.headers.get("Authorization") ?? "";
    const jwt = authz.replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(jwt);
    if (!user) return json({ error: "unauthorized" }, 401);
    const { data: prof } = await admin
      .from("planipret_profiles").select("role").eq("user_id", user.id).maybeSingle();
    const { data: isSuper } = await admin.rpc("is_super_admin", { _user_id: user.id });
    if (!(prof?.role === "admin" || isSuper === true)) return json({ error: "forbidden" }, 403);
    trigger = "manual";
  }

  const body = await req.json().catch(() => ({}));
  const nowYear = new Date().getFullYear();
  const yearFrom = Number(body?.year_from) || 2022;
  const from = `${yearFrom}-01-01 00:00:00`;
  const to = `${nowYear}-12-31 23:59:59`;

  const { data: run } = await admin
    .from("planipret_commission_sync_runs")
    .insert({ trigger_source: trigger }).select("id").maybeSingle();
  const runId = run?.id ?? null;

  const adminTok = await getMaestroAdminAccessToken();

  const { data: profiles } = await admin
    .from("planipret_profiles")
    .select("user_id, full_name, email, maestro_broker_id, maestro_connected")
    .limit(1000);

  const onlyBrokers = Array.isArray(body?.broker_ids)
    ? new Set((body.broker_ids as unknown[]).map((v) => String(v)))
    : null;
  const list = (profiles ?? [])
    .filter((p: any) => p.user_id)
    .filter((p: any) => !onlyBrokers || onlyBrokers.has(String(p.user_id)));

  // A firm credential can expose Maestro's complete agents directory. Resolve
  // missing local IDs before fan-out so brokers do not remain permanently
  // classified as "not connected" merely because their ID was never cached.
  if (adminTok.token) {
    const directory = await commissionGet("/api/main/commissions/reports/agents", adminTok.token, cid);
    const agentRows: any[] = directory.ok
      ? (Array.isArray(directory.data?.data) ? directory.data.data : Array.isArray(directory.data) ? directory.data : [])
      : [];
    const byName = new Map<string, string>();
    const byEmail = new Map<string, string>();
    for (const a of agentRows) {
      const id = a?.users_id ?? a?.agent_name_id ?? a?.id;
      if (id == null) continue;
      const name = String(a?.agent_name ?? a?.name ?? a?.full_name ?? [a?.first_name, a?.last_name].filter(Boolean).join(" ") ?? "").trim();
      const email = String(a?.email ?? "").trim().toLowerCase();
      const nk = agentKey(name);
      if (nk) byName.set(nk, String(id));
      if (email) byEmail.set(email, String(id));
    }
    // On corrige AUSSI les identifiants déjà stockés mais erronés : un id qui
    // appartient en réalité à un autre courtier ferait voir à ce profil les
    // commissions d'un collègue.
    const resolved: { user_id: string; maestro_broker_id: string | null }[] = [];
    for (const p of list as any[]) {
      const id = byEmail.get(String(p.email ?? "").trim().toLowerCase())
        ?? (agentKey(String(p.full_name ?? "")) ? byName.get(agentKey(String(p.full_name ?? "")) as string) : undefined);
      if (!id) continue;
      if (String(p.maestro_broker_id ?? "") === String(id)) continue;
      p.maestro_broker_id = id;
      resolved.push({ user_id: p.user_id, maestro_broker_id: id });
    }
    for (const p of resolved) {
      await admin.from("planipret_profiles").update({ maestro_broker_id: p.maestro_broker_id }).eq("user_id", p.user_id);
    }
  }
  let connectedCount = 0;
  let upserted = 0;
  const diagRows: any[] = [];

  // Ownership maps: which portal account each Maestro agent id / name belongs to.
  const profileByMaestroId = new Map<string, string>();
  const profileByNameKey = new Map<string, string>();
  for (const p of list as any[]) {
    if (p.maestro_broker_id != null) profileByMaestroId.set(String(p.maestro_broker_id), p.user_id);
    const nk = agentKey(String(p.full_name ?? ""));
    if (nk) profileByNameKey.set(nk, p.user_id);
  }

  // La commission brute = base + bonus + bonus2 + perform. Maestro ne renvoie
  // qu'un bucket par appel, donc on parcourt les quatre; le volume de prêt
  // n'est conservé que sur la ligne "base" pour éviter de le compter 4 fois.
  const COMMISSION_BUCKETS = ["base", "bonus", "bonus2", "perform"] as const;

  const fetchPages = async (token: string, usersId: string | null) => {
    const rows: CommissionDepositRow[] = [];
    let firstError: null | { status: number; message: string } = null;
    for (const ctype of COMMISSION_BUCKETS) {
      let page = 1;
      while (page <= MAX_PAGES) {
        const qs = buildDepositQuery({
          date_from: from, date_to: to, page, per_page: PER_PAGE, commission_type: ctype, order_by: "number", sort: "asc",
          ...(usersId ? { users_id: usersId } : {}),
        } as any);
        const r = await commissionGet(`/api/main/commissions/reports/deposits?${qs}`, token, cid);
        if (!r.ok) {
          const err = { status: r.status, message: String(r.data?.message ?? r.data?.error ?? `HTTP ${r.status}`) };
          if (ctype === "base") return { rows, error: err };
          firstError = firstError ?? err;
          break;
        }
        const batch: CommissionDepositRow[] = Array.isArray(r.data?.data) ? r.data.data : [];
        for (const row of batch) {
          rows.push({
            ...row,
            commission_type: (row as any).commission_type ?? ctype,
            loan_amt: ctype === "base" ? (row as any).loan_amt : 0,
          } as CommissionDepositRow);
        }
        const lastPage = Number(r.data?.meta?.last_page ?? 1);
        if (page >= lastPage || batch.length === 0) break;
        page += 1;
      }
    }
    return { rows, error: null as null | { status: number; message: string } };
  };

  // ---- Change probe: compare each broker's Maestro rows with stored hashes ----
  // Small batches keep each worker under its memory/CPU limit; the run
  // chains itself until every broker has been probed this cycle.
  const BATCH = 4;
  const chainDepth = Number(body?.chain) || 0;
  const cycleStart = typeof body?.cycle_start === "string" ? body.cycle_start : new Date().toISOString();
  const carriedChange = body?.changed === true;
  const deadline = Date.now() + 90_000;
  let anyChanged = false, probed = 0, skippedForTime = 0;
  const { data: stateRows } = await admin.from("planipret_commission_source_state")
    .select("maestro_broker_id, source, last_checked_at").neq("source", "global");
  const lastChecked = new Map<string, number>();
  for (const s of (stateRows ?? []) as any[]) {
    const t = s.last_checked_at ? new Date(s.last_checked_at).getTime() : 0;
    lastChecked.set(String(s.maestro_broker_id), Math.min(lastChecked.get(String(s.maestro_broker_id)) ?? Infinity, t));
  }
  // Oldest-checked first so a time-budget cut resumes with the next brokers.
  (list as any[]).sort((a, b) => (lastChecked.get(String(a.maestro_broker_id)) ?? 0) - (lastChecked.get(String(b.maestro_broker_id)) ?? 0));

  const loadStored = async (src: "paid" | "pending", mid: string) => {
    const m = new Map<string, string>();
    for (let off = 0; ; off += 1000) {
      const { data } = await admin.from("planipret_commission_rows").select("row_key,row_hash")
        .eq("source", src).eq("maestro_broker_id", mid).is("removed_at", null).range(off, off + 999);
      for (const r of (data ?? []) as any[]) m.set(r.row_key, r.row_hash);
      if (!data || data.length < 1000) break;
    }
    return m;
  };
  /** Returns true when the source changed (and persists the delta only then). */
  const probe = async (src: "paid" | "pending", mid: string, rows: { key: string; data: unknown }[]) => {
    const now = new Date().toISOString();
    const stored = await loadStored(src, mid);
    const { data: st } = await admin.from("planipret_commission_source_state").select("set_hash,pending_misses,last_review_at")
      .eq("maestro_broker_id", mid).eq("source", src).maybeSingle();
    const prev = new Set<string>(Array.isArray((st as any)?.pending_misses) ? (st as any).pending_misses : []);
    const d = decideChange(rows.map((r) => r.key), new Set(stored.keys()), prev);
    const byKey = new Map(rows.map((r) => [r.key, r.data]));
    let setHash = (st as any)?.set_hash ?? null;
    let review: DeltaReview | null = null;
    if (d.changed || !setHash) {
      for (let i = 0; i < d.added.length; i += 500) {
        await admin.from("planipret_commission_rows").upsert(d.added.slice(i, i + 500).map((k) => ({
          source: src, maestro_broker_id: mid, row_key: k, row_hash: k, row_data: byKey.get(k), last_seen: now, removed_at: null,
        })), { onConflict: "source,maestro_broker_id,row_key" });
      }
      for (let i = 0; i < d.confirmedRemoved.length; i += 200) {
        await admin.from("planipret_commission_rows").update({ removed_at: now })
          .eq("source", src).eq("maestro_broker_id", mid).in("row_key", d.confirmedRemoved.slice(i, i + 200));
      }
      const removed = new Set(d.confirmedRemoved);
      const active = [...new Set([...stored.keys(), ...d.added])].filter((k) => !removed.has(k)).sort();
      setHash = fastHash(active.join("\n")) + ":" + active.length;
      // Claude reviews ONLY the new rows (advisory, bounded, at most hourly
      // per broker/source) and never when the time budget is nearly spent.
      if (setHash && (st as any)?.set_hash && shouldReview(d.added.length, (st as any)?.last_review_at) && Date.now() < deadline - 25_000) {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 15_000);
        review = await reviewCommissionDelta({
          source: src, added: d.added.map((k) => byKey.get(k)), removedCount: d.confirmedRemoved.length, totalRows: rows.length,
        }, undefined, ctl.signal).catch(() => null);
        clearTimeout(timer);
      }
    }
    await admin.from("planipret_commission_source_state").upsert({
      maestro_broker_id: mid, source: src, set_hash: setHash, row_count: rows.length, pending_misses: d.newMisses,
      last_checked_at: now, ...(d.changed ? { last_changed_at: now } : {}), last_error: null,
      ...(review ? { last_review: review, last_review_at: review.at } : {}),
    }, { onConflict: "maestro_broker_id,source" });
    if (d.changed) { anyChanged = true; log(src, mid, "added", d.added.length, "removed", d.confirmedRemoved.length, "review", review?.status ?? "none"); }
    return d.changed;
  };
  const markError = async (src: "paid" | "pending", mid: string, err: string) => {
    await admin.from("planipret_commission_source_state").upsert({
      maestro_broker_id: mid, source: src, last_checked_at: new Date().toISOString(), last_error: err.slice(0, 200),
    }, { onConflict: "maestro_broker_id,source" });
  };
  // Change detection only (totals come from planipret-commission-reports):
  // Maestro pending pages are not order-stable, so rows are keyed by content
  // and the page set is re-read until every row Maestro reports is seen.
  const fetchPendingRows = async (token: string, usersId: string | null) => {
    const byKey = new Map<string, any>();
    let expected = 0;
    for (let pass = 0; pass < 4; pass++) {
      const before = byKey.size;
      for (let page = 1; page <= 25; page++) {
        const qs = new URLSearchParams({ page: String(page), per_page: "200" });
        if (usersId) qs.set("users_id", usersId);
        const r = await commissionGet(`${PENDING_COMMISSION_PATH}?${qs}`, token, cid);
        if (!r.ok) return { rows: null as null | { key: string; data: unknown }[], status: r.status };
        const batch: any[] = Array.isArray(r.data?.data) ? r.data.data : [];
        for (const row of batch) { const k = fastHash(stableJson(row)); if (!byKey.has(k)) byKey.set(k, row); }
        expected = Number(r.data?.meta?.total ?? 0) || expected;
        if (page >= Number(r.data?.meta?.last_page ?? 1) || batch.length === 0) break;
      }
      if (byKey.size >= expected || byKey.size === before) break;
    }
    return { rows: contentKeyed([...byKey.values()]), status: 200 };
  };

  for (const p of list as any[]) {
    const label = String(p.full_name ?? p.email ?? p.user_id);
    const attemptedAt = new Date().toISOString();
    const mid = p.maestro_broker_id != null ? String(p.maestro_broker_id) : null;
    if ((lastChecked.get(String(mid ?? `u:${p.user_id}`)) ?? 0) >= new Date(cycleStart).getTime()) continue;
    if (Date.now() > deadline || probed >= BATCH) { skippedForTime++; continue; }

    // Prefer the broker's own token (always correctly scoped); fall back to the
    // admin-scoped credential when the broker never connected.
    let token: string | null = await getUserMaestroAccessToken(admin, p.user_id).catch(() => null);
    let source: "broker_token" | "admin_token" = "broker_token";
    if (!token && adminTok.token && mid) { token = adminTok.token; source = "admin_token"; }

    if (!token) {
      diagRows.push({
        broker_user_id: p.user_id, broker_label: label, broker_email: p.email ?? null,
        maestro_broker_id: mid, connected: false, status: "not_connected",
        reason: adminTok.token
          ? (mid ? "no_broker_token_and_admin_lookup_failed" : "no_broker_token_and_no_maestro_broker_id")
          : `maestro_not_connected (${adminTok.reason ?? "admin_scope_not_configured"})`,
        http_status: null, rows_count: 0, source: null, last_attempt_at: attemptedAt,
      });
      continue;
    }

    const { rows, error } = await fetchPages(token, source === "admin_token" ? mid : null);
    if (error) {
      const reason = error.status >= 500
        ? "maestro_upstream_temporarily_unavailable"
        : `${source}:${error.message}`.slice(0, 400);
      diagRows.push({
        broker_user_id: p.user_id, broker_label: label, broker_email: p.email ?? null,
        maestro_broker_id: mid, connected: source === "broker_token", status: "error",
        // A 5xx means the broker token was accepted but Maestro was temporarily
        // unavailable. The scheduled 30-minute run retries it; never persist
        // raw proxy HTML in a diagnostic visible to brokers.
        reason, http_status: error.status,
        rows_count: 0, source, last_attempt_at: attemptedAt,
      });
      await markError("paid", mid ?? `u:${p.user_id}`, `http_${error.status}`);
      await markError("pending", mid ?? `u:${p.user_id}`, "paid_failed_skipped");
      continue;
    }

    if (source === "broker_token") connectedCount += 1;

    // A team-lead / admin token returns OTHER brokers' deposits too. Each row is
    // attributed to the broker it actually belongs to (Maestro agent id, then
    // name), never to the account that fetched it — otherwise a broker would see
    // his colleagues' commissions in his own totals.
    const payload = rows.map((row) => {
      const date = row.date_trans ? String(row.date_trans).slice(0, 10) : null;
      const rowMid = row.agent_name_id != null ? String(row.agent_name_id) : mid;
      const rowName = String(row.agent_name ?? row.target_name ?? "").trim();
      // Le nom de l'agent Maestro prime : c'est la seule donnée qui reste juste
      // même si un profil porte un identifiant Maestro périmé ou erroné.
      const owner = (agentKey(rowName) ? profileByNameKey.get(agentKey(rowName) as string) : null)
        ?? (rowMid ? profileByMaestroId.get(rowMid) : null)
        ?? (rowMid && mid && rowMid === mid ? p.user_id : null);
      return {
        dedupe_key: dedupeKey(row as any),
        broker_user_id: owner ?? null,
        broker_label: label,
        maestro_broker_id: row.agent_name_id != null ? String(row.agent_name_id) : mid,
        agent_name: String(row.agent_name ?? row.target_name ?? label).trim() || label,
        date_trans: date,
        fiscal_year: date ? Number(date.slice(0, 4)) : null,
        row_data: {
          number: row.number ?? null,
          loan_amt: num(row.loan_amt),
          institution: row.institution ?? null,
          amount: num(row.amount),
          mortgage_type: row.mortgage_type ?? null,
          term: row.term != null ? String(row.term) : null,
          target_name: row.target_name ?? null,
          commission_type: row.commission_type ?? "base",
          split_type: row.split_type ?? null,
          cabinet: row.cabinet ?? null,
          is_adjustment: row.is_adjustment ?? null,
        },
        synced_at: new Date().toISOString(),
      };
    });

    // Deduplicate inside the batch before upserting (same key can repeat).
    const byKey = new Map<string, any>();
    for (const r of payload) byKey.set(r.dedupe_key, r);
    const unique = [...byKey.values()];

    // Unchanged paid set => no write at all; changed => only then refresh cache.
    const pk = mid ?? `u:${p.user_id}`;
    probed++;
    const paidChanged = await probe("paid", pk, contentKeyed(payload.map((u) => ({ ...u.row_data, date_trans: u.date_trans, agent: u.maestro_broker_id }))));
    if (paidChanged) {
      for (let i = 0; i < unique.length; i += 500) {
        const { error: upErr } = await admin
          .from("planipret_commission_live_cache")
          .upsert(unique.slice(i, i + 500).map((u) => ({ ...u, synced_at: new Date().toISOString() })), { onConflict: "dedupe_key" });
        if (upErr) console.error(`[${cid}] upsert failed`, upErr.message);
        else upserted += Math.min(500, unique.length - i);
      }
    }

    // Pending: same token and scope; a failure keeps the last good state.
    const pend = await fetchPendingRows(token, source === "admin_token" ? mid : null);
    if (pend.rows) await probe("pending", pk, pend.rows);
    else await markError("pending", pk, `http_${pend.status}`);

    diagRows.push({
      broker_user_id: p.user_id, broker_label: label, broker_email: p.email ?? null,
      maestro_broker_id: mid, connected: source === "broker_token", status: "ok",
      reason: unique.length === 0 ? "connected_but_api_returned_no_deposits" : null,
      http_status: 200, rows_count: unique.length, source,
      last_ok_at: new Date().toISOString(), last_attempt_at: attemptedAt,
    });
  }

  // More brokers left in this cycle => hand off to the next batch.
  if (skippedForTime > 0 && chainDepth < 20) {
    const next = fetch(`${url}/functions/v1/pp-commission-live-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ ...body, chain: chainDepth + 1, cycle_start: cycleStart, changed: anyChanged || carriedChange }),
    }).catch(() => {});
    (globalThis as any).EdgeRuntime?.waitUntil?.(next);
    return json({ ok: true, cid, partial: true, probed, changed: anyChanged });
  }
  anyChanged = anyChanged || carriedChange;
  // Global version moves only when at least one broker's data changed.
  if (anyChanged) {
    const { data: all } = await admin.from("planipret_commission_source_state")
      .select("maestro_broker_id, source, set_hash").neq("source", "global");
    const sig = ((all ?? []) as any[]).map((s) => `${s.maestro_broker_id}|${s.source}|${s.set_hash ?? ""}`).sort().join("\n");
    const version = fastHash(sig) + ":" + (all ?? []).length;
    const now = new Date().toISOString();
    await admin.from("planipret_commission_source_state").upsert({
      maestro_broker_id: "*", source: "global", set_hash: version, row_count: (all ?? []).length,
      last_checked_at: now, last_changed_at: now,
    }, { onConflict: "maestro_broker_id,source" });
    // Refresh only the per-broker buckets whose rows changed, so the global
    // view below reads ready-made data instead of re-reading everything.
    try { const b = await ensureBuckets(admin, "live"); log("buckets", b); } catch (e) { log("buckets failed", String(e).slice(0, 200)); }
    // Rebuild recently viewed snapshots once, then a figure-free nudge.
    try {
      await fetch(`${url}/functions/v1/planipret-commission-reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ action: "warm_snapshots" }),
      });
    } catch { /* best effort */ }
  } else {
    await admin.from("planipret_commission_source_state").update({ last_checked_at: new Date().toISOString() })
      .eq("maestro_broker_id", "*").eq("source", "global");
  }

  for (let i = 0; i < diagRows.length; i += 200) {
    await admin.from("planipret_commission_sync_diag")
      .upsert(diagRows.slice(i, i + 200), { onConflict: "broker_user_id" });
  }

  if (runId) {
    await admin.from("planipret_commission_sync_runs").update({
      finished_at: new Date().toISOString(),
      brokers_total: list.length,
      brokers_connected: connectedCount,
      rows_upserted: upserted,
      admin_token_used: adminTok.source !== "none",
    }).eq("id", runId);
  }

  return json({
    ok: true,
    cid,
    brokers_total: list.length,
    brokers_connected: connectedCount,
    rows_upserted: upserted,
    probed, changed: anyChanged, skipped_for_time: skippedForTime,
    admin_scope: { configured: adminTok.source !== "none", source: adminTok.source, reason: adminTok.reason ?? null },
  });
});
