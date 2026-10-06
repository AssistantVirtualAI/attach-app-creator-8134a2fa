export const LEMTEL_CSV_COLUMNS = ["first_name", "last_name", "email", "language", "role"] as const;
export type LemtelCsvRow = Record<(typeof LEMTEL_CSV_COLUMNS)[number], string>;
export type RowIssue = "missing_name" | "invalid_email" | "duplicate_email" | "invalid_language" | "invalid_role" | "language_inherited";
export interface ParsedRow { line: number; data: LemtelCsvRow; errors: RowIssue[]; warnings: RowIssue[] }

/** The authoritative onboarding function permits admin and member for provisioned users. */
export const LEMTEL_ROLES = ["admin", "member"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function csvTemplate(): string {
  return `${LEMTEL_CSV_COLUMNS.join(",")}\nMarie,Tremblay,marie@example.com,fr,member\n`;
}

function splitLine(line: string): string[] {
  const output: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"' && line[index + 1] === '"') { current += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else current += character;
    } else if (character === '"') quoted = true;
    else if (character === "," || character === ";") { output.push(current); current = ""; }
    else current += character;
  }
  output.push(current);
  return output.map((value) => value.trim());
}

export function parseLemtelCsv(text: string): { rows: ParsedRow[]; headerError: boolean } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return { rows: [], headerError: true };
  const header = splitLine(lines[0]).map((column) => column.toLowerCase());
  if (!["first_name", "last_name", "email"].every((column) => header.includes(column))) return { rows: [], headerError: true };

  const seen = new Set<string>();
  const rows = lines.slice(1).map((line, index) => {
    const cells = splitLine(line);
    const data = Object.fromEntries(LEMTEL_CSV_COLUMNS.map((column) => [column, cells[header.indexOf(column)] ?? ""])) as LemtelCsvRow;
    data.email = data.email.toLowerCase();
    data.language = data.language.toLowerCase();
    data.role = (data.role || "member").toLowerCase();
    const errors: RowIssue[] = [];
    const warnings: RowIssue[] = [];
    if (!data.first_name || !data.last_name) errors.push("missing_name");
    if (!EMAIL_RE.test(data.email)) errors.push("invalid_email");
    else if (seen.has(data.email)) errors.push("duplicate_email");
    seen.add(data.email);
    if (!data.language) warnings.push("language_inherited");
    else if (!(["fr", "en"] as string[]).includes(data.language)) errors.push("invalid_language");
    if (!(LEMTEL_ROLES as readonly string[]).includes(data.role)) errors.push("invalid_role");
    return { line: index + 2, data, errors, warnings };
  });
  return { rows, headerError: false };
}

/** Results export excludes passwords, tokens and opaque user identifiers. */
export function resultsCsv(rows: { email: string; status: string }[]): string {
  const escape = (value: string) => `"${String(value).replace(/"/g, '""')}"`;
  return ["email,status", ...rows.map((row) => `${escape(row.email)},${escape(row.status)}`)].join("\n");
}
