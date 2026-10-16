// Pushes a broker's telecom profile change to Maestro's widget sync webhook
// (POST {telecom}/sync). external_user_id = NetSapiens user (extension);
// omitted when the extension is released so Maestro removes the local profile.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getMaestroTelecomConfig, maestroTelecomFetch, type MaestroTelecomConfig } from "./maestro-telecom.ts";

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;

export type WidgetSyncPayload = { user_id: string; external_user_id?: string };
export type WidgetSyncResult = { ok: boolean; status: number; skipped?: "not_linked" | "debounced" | "not_configured"; error_code?: string };

const lastSent = new Map<string, number>();
export const DEBOUNCE_MS = 30_000;

export function buildWidgetPayload(crmId: unknown, extension: unknown, released: boolean): WidgetSyncPayload | null {
  const uid = String(crmId ?? "").trim();
  if (!uid) return null;
  const ext = String(extension ?? "").trim();
  return !released && ext ? { user_id: uid, external_user_id: ext } : { user_id: uid };
}

export function shouldDebounce(key: string, now = Date.now()): boolean {
  const prev = lastSent.get(key);
  if (prev && now - prev < DEBOUNCE_MS) return true;
  lastSent.set(key, now);
  return false;
}

export function _resetDebounce() { lastSent.clear(); }

export async function postWidgetSync(
  cfg: MaestroTelecomConfig, payload: WidgetSyncPayload,
  fetcher: typeof maestroTelecomFetch = maestroTelecomFetch,
): Promise<WidgetSyncResult> {
  if (!cfg.url || !cfg.key) return { ok: false, status: 0, skipped: "not_configured" };
  const r = await fetcher(cfg, "/sync", { method: "POST", body: payload, maxAttempts: 4, timeoutMs: 10_000 });
  return r.ok ? { ok: true, status: r.status } : { ok: false, status: r.status, error_code: r.status === 0 ? "network" : `http_${r.status}` };
}

/** Explicit ids win (needed for deletes, where the profile is gone). */
export async function syncBrokerToWidget(
  admin: SupabaseClient,
  sel: { userId?: string | null; extension?: string | null; crmId?: string | null; released?: boolean; force?: boolean },
): Promise<WidgetSyncResult> {
  let crmId = sel.crmId ?? null;
  let ext = sel.extension ?? null;
  let uid = sel.userId ?? null;
  if (!crmId) {
    let q = admin.from("planipret_profiles").select("user_id, extension, ns_extension, maestro_broker_id").limit(1);
    if (uid) q = q.eq("user_id", uid);
    else if (ext) q = q.or(`extension.eq.${ext},ns_extension.eq.${ext}`);
    else return { ok: false, status: 0, skipped: "not_linked" };
    const { data } = await q.maybeSingle();
    if (!data) return { ok: false, status: 0, skipped: "not_linked" };
    crmId = (data as any).maestro_broker_id ?? null;
    uid = (data as any).user_id ?? uid;
    ext = ext ?? (data as any).ns_extension ?? (data as any).extension ?? null;
  }
  const payload = buildWidgetPayload(crmId, ext, !!sel.released);
  if (!payload) return { ok: false, status: 0, skipped: "not_linked" };
  if (!sel.force && shouldDebounce(`${payload.user_id}:${payload.external_user_id ?? "-"}`)) {
    return { ok: true, status: 0, skipped: "debounced" };
  }
  const res = await postWidgetSync(await getMaestroTelecomConfig(admin), payload);
  try {
    await admin.from("planipret_maestro_sync_log").insert({
      user_id: uid, action: payload.external_user_id ? "widget.sync" : "widget.release",
      maestro_endpoint: "POST /sync", request_body: { has_external: !!payload.external_user_id },
      response_body: res.ok ? null : { error: res.error_code ?? res.skipped }, response_status: res.status,
    });
  } catch { /* best effort */ }
  return res;
}

/** Fire-and-forget; never blocks or fails the caller. */
export function queueWidgetSync(admin: SupabaseClient, sel: Parameters<typeof syncBrokerToWidget>[1]) {
  const p = syncBrokerToWidget(admin, sel).catch((e) => console.warn("[widget-sync] failed", String(e).slice(0, 120)));
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(p);
}
