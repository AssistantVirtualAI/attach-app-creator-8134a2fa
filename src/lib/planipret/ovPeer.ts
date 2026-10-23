/** Formats a North-American number for display; leaves extensions/other values untouched. */
export function formatPhoneDisplay(v: unknown): string | null {
  const raw = String(v ?? "").trim();
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return raw;
}
