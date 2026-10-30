// Résume une erreur de démarrage vocal sans exposer de jeton ni de secret.
export function describeVoiceStartError(err: unknown): string {
  const e = err as any;
  if (!e) return "unknown";
  const name = String(e?.name ?? "Error");
  const code = e?.code != null ? String(e.code) : "";
  let msg = String(e?.message ?? e ?? "");
  msg = msg.replace(/(token|signed_url|secret|key)[=:]\S+/gi, "$1=[redacted]").replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[jwt]").replace(/wss?:\/\/\S+/g, "[url]");
  if (name === "NotAllowedError") return "microphone_denied";
  if (name === "NotFoundError") return "microphone_missing";
  return [name, code, msg].filter(Boolean).join(": ").slice(0, 180);
}
