export const LEMTEL_CSV_COLUMNS = ["first_name", "last_name", "email", "language", "role", "department", "title"] as const;
export type LemtelCsvRow = Record<(typeof LEMTEL_CSV_COLUMNS)[number], string>;
export type RowIssue = "missing_name" | "invalid_email" | "duplicate_email" | "invalid_language" | "invalid_role" | "language_inherited";
export interface ParsedRow { line: number; data: LemtelCsvRow; errors: RowIssue[]; warnings: RowIssue[] }

export const LEMTEL_ROLES = ["user", "manager", "administrator"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function csvTemplate(): string {
  return `${LEMTEL_CSV_COLUMNS.join(",")}\nMarie,Tremblay,marie@example.com,fr,user,Ventes,Conseillère\n`;
}

function splitLine(line: string): string[] {
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === "," || ch === ";") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseLemtelCsv(text: string): { rows: ParsedRow[]; headerError: boolean } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { rows: [], headerError: true };
  const header = splitLine(lines[0]).map((h) => h.toLowerCase());
  if (!["first_name", "last_name", "email"].every((c) => header.includes(c))) return { rows: [], headerError: true };
  const seen = new Set<string>();
  const rows = lines.slice(1).map((l, i) => {
    const cells = splitLine(l);
    const data = Object.fromEntries(LEMTEL_CSV_COLUMNS.map((c) => [c, cells[header.indexOf(c)] ?? ""])) as LemtelCsvRow;
    data.email = data.email.toLowerCase();
    data.language = data.language.toLowerCase();
    data.role = (data.role || "user").toLowerCase();
    const errors: RowIssue[] = []; const warnings: RowIssue[] = [];
    if (!data.first_name || !data.last_name) errors.push("missing_name");
    if (!EMAIL_RE.test(data.email)) errors.push("invalid_email");
    else if (seen.has(data.email)) errors.push("duplicate_email");
    seen.add(data.email);
    if (!data.language) warnings.push("language_inherited");
    else if (!["fr", "en"].includes(data.language)) errors.push("invalid_language");
    if (!(LEMTEL_ROLES as readonly string[]).includes(data.role)) errors.push("invalid_role");
    return { line: i + 2, data, errors, warnings };
  });
  return { rows, headerError: false };
}

/** Results export — never contains passwords or tokens. */
export function resultsCsv(rows: { email: string; status: string }[]): string {
  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  return ["email,status", ...rows.map((r) => `${esc(r.email)},${esc(r.status)}`)].join("\n");
}
