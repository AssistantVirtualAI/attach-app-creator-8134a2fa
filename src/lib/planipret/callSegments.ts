// Regroupe les segments CDR d'un même appel déplacé entre appareils
// (Move My Call). NetSapiens produit une fiche par appareil + une fiche
// « MoveMyCall » ; toutes les vraies fiches partagent call-parent-call-id.

type AnyCall = Record<string, any>;

// Lecture en direct : metadata.netSapiens ; lignes enregistrées : metadata à plat.
const raw = (c: AnyCall) => (c?.metadata?.netSapiens ?? c?.metadata ?? {}) as AnyCall;

export function parentCallId(c: AnyCall): string | null {
  const v = c?.ns_parent_callid || raw(c)["call-parent-call-id"] || null;
  return v ? String(v) : null;
}

/** Fiche de service MoveMyCall : destination MoveMyCall, parent vide. */
export function isMoveMyCallHelper(c: AnyCall): boolean {
  const r = raw(c);
  const dest = [r["call-orig-to-user"], r["call-term-user"], r["call-orig-to-uri"], r["call-term-to-uri"], c.to_number]
    .filter(Boolean).map(String).join(" ").toLowerCase();
  return dest.includes("movemycall") && !r["call-parent-call-id"] && !c.ns_parent_callid;
}

/** « Retrieved » = déplacé vers un autre appareil, pas la fin de l'appel. */
export function isHandoffSegment(c: AnyCall): boolean {
  return String(raw(c)["call-disconnect-reason-text"] ?? "").toLowerCase() === "retrieved";
}

export function groupCallSegments<T extends AnyCall>(calls: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const call of calls) {
    if (isMoveMyCallHelper(call)) continue;
    const key = parentCallId(call) || call.ns_orig_callid || call.id;
    const list = groups.get(key);
    if (list) list.push(call); else groups.set(key, [call]);
  }
  return [...groups.values()].map((segs) => {
    if (segs.length === 1) return segs[0];
    const ordered = [...segs].sort((a, b) => new Date(a.started_at ?? 0).getTime() - new Date(b.started_at ?? 0).getTime());
    const first = ordered[0];
    const last = [...ordered].reverse().find((s) => !isHandoffSegment(s)) ?? ordered[ordered.length - 1];
    const pickAny = (k: string) => ordered.map((s) => s[k]).find(Boolean) ?? null;
    return {
      ...first,
      status: last.status ?? first.status,
      duration_seconds: ordered.reduce((n, s) => n + (Number(s.duration_seconds) || 0), 0),
      recording_url: pickAny("recording_url"),
      has_recording: ordered.some((s) => s.has_recording),
      transcript: pickAny("transcript"),
      ai_summary: pickAny("ai_summary"),
      metadata: { ...(first.metadata ?? {}), handoff_segments: ordered.length },
    } as T;
  });
}
