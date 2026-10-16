export const LEGACY_MODELS = ["call", "cdr", "message", "voicemail"] as const;
export const ALL_MODELS = [...LEGACY_MODELS, "subscriber"] as const;
export type NsModel = typeof ALL_MODELS[number];

/** No `models` → full legacy set. Otherwise only known, deduplicated models; empty/invalid → error. */
export function parseModels(body: unknown): { ok: true; models: NsModel[] } | { ok: false; error: string } {
  const raw = (body && typeof body === "object") ? (body as Record<string, unknown>).models : undefined;
  if (raw === undefined) return { ok: true, models: [...LEGACY_MODELS] };
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "models_invalid" };
  const out: NsModel[] = [];
  for (const m of raw) {
    if (typeof m !== "string" || !(ALL_MODELS as readonly string[]).includes(m)) return { ok: false, error: "models_unknown" };
    if (!out.includes(m as NsModel)) out.push(m as NsModel);
  }
  return { ok: true, models: out };
}
