// Résume une erreur de démarrage vocal sans exposer de jeton ni de secret.
function redactVoiceErrorValue(value: unknown): string {
  return String(value ?? "")
    .replace(/\b(?:https?|wss?):\/\/\S+/gi, "[url]")
    .replace(/\b(?:authorization|bearer)\s+[^\s,;]+/gi, "authorization=[redacted]")
    .replace(/\b(token|signed_url|secret|key|signature|authorization)\s*[=:]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[jwt]");
}

export function describeVoiceStartError(err: unknown): string {
  const e = err as any;
  if (!e) return "unknown";
  const name = redactVoiceErrorValue(e?.name ?? "Error");
  const code = redactVoiceErrorValue(e?.code != null ? e.code : "");
  const msg = redactVoiceErrorValue(e?.message ?? e ?? "");
  if (name === "NotAllowedError") return "microphone_denied";
  if (name === "NotFoundError") return "microphone_missing";
  return [name, code, msg].filter(Boolean).join(": ").slice(0, 180);
}
