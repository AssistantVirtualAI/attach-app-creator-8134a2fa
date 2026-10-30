import { MARC_SMS_USER_ID, smsPeer } from "./ava-sms-policy.ts";

/** Fail closed: handoff storage must be installed before these functions deploy. */
export async function handoffCommand(admin: any, op: string, args: Record<string, unknown> = {}) {
  const { data, error } = await admin.rpc("pp_ava_sms_handoff", { p_user: MARC_SMS_USER_ID, p_op: op, p_args: args });
  if (error || !data) throw new Error("handoff_unavailable");
  return data;
}
export async function handoffPaused(admin: any, peer: string, jobId?: string) {
  const state = await handoffCommand(admin, "check", { peer, job_id: jobId });
  return state.paused === true;
}
export function handoffSummary(history: { role: string; text: string }[], reply: string, name?: string | null) {
  const greeting = `Hey Marc, je viens de discuter avec ${name || "un correspondant"}. Voici le résumé de notre échange. Tu peux reprendre la discussion.`;
  // Evidence-based digest, not an invented model recap; bounded history is explicitly labelled.
  const recent = history.filter(row => row.role === "user").slice(-3).map(row => row.text.slice(0, 400));
  return `${greeting}\nDemandes récentes : ${recent.join(" / ") || "Consulte le fil."}\nRéponse d’AVA : ${reply.slice(0, 1100)}\nContexte : historique disponible seulement; exhaustivité non confirmée.`;
}
/** Only exact provider ownership establishes a human outbound observation. */
export function providerHumanOutbound(message: any, avaBodies: Set<string>, activatedAt: string, avaIds: Set<string> = new Set()) {
  if (String(message?.direction ?? "").toLowerCase() !== "term" || message?.["from-user-id"] !== "1136@planipret.ca" || message?.["deleted-datetime"] || avaIds.has(String(message?.id))) return null;
  const body = String(message?.text ?? "").trim();
  if (!body || avaBodies.has(body) || /—\s*AVA,\s*assistante de Marc Maglieri\s*$/u.test(body)) return null;
  const raw = String(message.timestamp ?? "").replace(" ", "T");
  const at = Date.parse(/Z|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}Z`);
  if (!Number.isFinite(at) || at < Date.parse(activatedAt)) return null;
  const peer = smsPeer(String(message?.["terminating-user-id"] ?? message?.["terminating-number"] ?? message?.dialed ?? "").split("@")[0]);
  return peer && message.id ? { peer, source_id: String(message.id), at: new Date(at).toISOString() } : null;
}