import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { translations } from "@/locales";
import { MP_DICT } from "@/lib/i18n/mplanipret";
import { verifyDictionary, type I18nIssue } from "@/lib/i18n/runtimeCheck";

/**
 * Intégration i18n : charge tous les dictionnaires configurés, compare chaque
 * locale à la locale de référence (FR) et échoue si une clé manque, est vide,
 * est dupliquée ou diverge de type. Un rapport JSON/Markdown est écrit dans
 * `i18n-report/` pour être publié en artifact CI.
 */

type Source = { file: string; dict: Record<string, unknown>; ref: string };

const SOURCES: Source[] = [
  { file: "src/locales/index.ts", dict: translations as unknown as Record<string, unknown>, ref: "fr" },
  { file: "src/lib/i18n/mplanipret.ts", dict: MP_DICT as unknown as Record<string, unknown>, ref: "fr" },
];

function flatten(obj: unknown, prefix = "", out: string[] = []): string[] {
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, path, out);
    else out.push(path);
  }
  return out;
}

const issues: I18nIssue[] = [];
const validated: { file: string; locale: string; keys: number }[] = [];

for (const src of SOURCES) {
  issues.push(...verifyDictionary(src.file, src.dict, src.ref));
  for (const [locale, value] of Object.entries(src.dict)) {
    validated.push({ file: src.file, locale, keys: flatten(value).length });
  }
}

const REPORT_DIR = process.env.I18N_REPORT_DIR || "i18n-report";
mkdirSync(REPORT_DIR, { recursive: true });
writeFileSync(
  join(REPORT_DIR, "locales.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), validated, issues }, null, 2),
);
writeFileSync(
  join(REPORT_DIR, "locales.md"),
  [
    "# i18n locale parity report",
    "",
    "| source | locale | validated keys |",
    "|---|---|---|",
    ...validated.map((v) => `| ${v.file} | ${v.locale} | ${v.keys} |`),
    "",
    `Issues: ${issues.length}`,
    "",
    ...(issues.length
      ? ["| source | key | kind | detail |", "|---|---|---|---|",
         ...issues.map((i) => `| ${i.file} | \`${i.key}\` | ${i.kind} | ${i.detail} |`)]
      : ["No missing, empty or divergent keys."]),
    "",
  ].join("\n"),
);

describe("i18n integrity (all configured locales)", () => {
  it("loads every dictionary with at least one key per locale", () => {
    expect(validated.length).toBeGreaterThan(0);
    for (const v of validated) expect(v.keys, `${v.file} → ${v.locale}`).toBeGreaterThan(0);
  });

  it("has no missing, empty or divergent key across locales", () => {
    const report = issues
      .slice(0, 100)
      .map((i) => `${i.file} → ${i.key} [${i.kind}] ${i.detail}`)
      .join("\n");
    expect(issues.length, `\n${report}\n`).toBe(0);
  });
});
