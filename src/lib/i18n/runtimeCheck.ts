// Runtime i18n integrity check.
//
// Runs once at boot (production included). It never throws and never blocks
// rendering: every problem is logged clearly and grouped in Sentry by
// file + key so regressions are traceable per dictionary entry.
import { captureException, captureMessage } from "@/lib/sentry";

export type I18nIssue = {
  /** Logical source file of the dictionary, e.g. "src/lib/i18n/mplanipret.ts". */
  file: string;
  /** Dot path of the offending key, e.g. "nav.accessLog". */
  key: string;
  kind: "missing" | "type-mismatch" | "empty" | "load-failure";
  detail: string;
};

const MAX_REPORTED = 50;

function flatten(obj: unknown, prefix = "", out = new Map<string, unknown>()): Map<string, unknown> {
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, path, out);
    else out.set(path, v);
  }
  return out;
}

/** Sends one grouped Sentry event per (file, key) so issues aggregate cleanly. */
export function reportI18nIssue(issue: I18nIssue) {
  const label = `[i18n] ${issue.kind}: ${issue.file} → ${issue.key}`;
  console.error(label, issue.detail);
  captureException(new Error(label), {
    i18n_file: issue.file,
    i18n_key: issue.key,
    i18n_kind: issue.kind,
    detail: issue.detail,
    fingerprint: `i18n:${issue.file}:${issue.key}`,
  });
}

/**
 * Compares a reference locale against its translations and reports any
 * missing, empty or structurally divergent key. Returns the issue list.
 */
export function verifyDictionary(
  file: string,
  dict: Record<string, unknown>,
  referenceLang: string,
): I18nIssue[] {
  const issues: I18nIssue[] = [];
  try {
    const reference = dict[referenceLang];
    if (!reference || typeof reference !== "object") {
      issues.push({ file, key: referenceLang, kind: "load-failure", detail: "reference locale missing" });
      return issues;
    }
    const refFlat = flatten(reference);

    for (const [lang, value] of Object.entries(dict)) {
      if (lang === referenceLang) continue;
      const flat = flatten(value);
      for (const [key, refValue] of refFlat) {
        const key2 = `${lang}.${key}`;
        if (!flat.has(key)) {
          issues.push({ file, key: key2, kind: "missing", detail: `absent from "${lang}"` });
          continue;
        }
        const v = flat.get(key);
        if (typeof v !== typeof refValue) {
          issues.push({
            file,
            key: key2,
            kind: "type-mismatch",
            detail: `${typeof v} vs ${typeof refValue} in "${referenceLang}"`,
          });
        } else if (typeof v === "string" && v.trim() === "") {
          issues.push({ file, key: key2, kind: "empty", detail: "empty translation string" });
        }
      }
      for (const key of flat.keys()) {
        if (!refFlat.has(key)) {
          issues.push({ file, key: `${lang}.${key}`, kind: "missing", detail: `absent from "${referenceLang}"` });
        }
      }
    }
  } catch (e) {
    issues.push({ file, key: "*", kind: "load-failure", detail: String(e) });
  }
  return issues;
}

/** Boot-time check — lazy imports so a broken dictionary can never break the app. */
export async function verifyI18nAtRuntime(): Promise<I18nIssue[]> {
  const issues: I18nIssue[] = [];

  const sources: { file: string; load: () => Promise<Record<string, unknown>>; ref: string }[] = [
    {
      file: "src/locales/index.ts",
      ref: "fr",
      load: async () => (await import("@/locales/index")).translations as unknown as Record<string, unknown>,
    },
    {
      file: "src/lib/i18n/mplanipret.ts",
      ref: "fr",
      load: async () => (await import("@/lib/i18n/mplanipret")).MP_DICT as unknown as Record<string, unknown>,
    },
  ];

  for (const src of sources) {
    try {
      const dict = await src.load();
      issues.push(...verifyDictionary(src.file, dict, src.ref));
    } catch (e) {
      issues.push({ file: src.file, key: "*", kind: "load-failure", detail: String(e) });
    }
  }

  if (issues.length === 0) {
    console.info("[i18n] dictionaries verified — no missing or divergent keys");
    return issues;
  }

  const byFile = issues.reduce<Record<string, number>>((acc, i) => {
    acc[i.file] = (acc[i.file] ?? 0) + 1;
    return acc;
  }, {});
  console.warn("[i18n] integrity issues detected", byFile);
  console.table?.(issues.slice(0, MAX_REPORTED));
  captureMessage(`[i18n] ${issues.length} dictionary issue(s): ${JSON.stringify(byFile)}`, "warning");
  for (const issue of issues.slice(0, MAX_REPORTED)) reportI18nIssue(issue);

  return issues;
}
