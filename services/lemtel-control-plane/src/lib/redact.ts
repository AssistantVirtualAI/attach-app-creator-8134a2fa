const SENSITIVE = /(authorization|cookie|password|passwd|secret|token|credential|sip|pbx|api[_-]?key)/i;
const URL_USERINFO = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi;

export const REDACTED = "[REDACTED]";

export function redactString(s: string): string {
  return s.replace(URL_USERINFO, `$1${REDACTED}@`);
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return REDACTED;
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE.test(k) ? REDACTED : redact(v, depth + 1);
    return out;
  }
  return value;
}
