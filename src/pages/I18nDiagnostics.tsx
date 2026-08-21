// Developer-only i18n diagnostics: shows dictionary load state, missing keys,
// collisions, and lets you search any key across every configured locale.
// Access: /planipret/i18n-diagnostics (dev build, or add ?debug=1 in prod).
import { useMemo, useState } from "react";
import { translations } from "@/locales";
import { MP_DICT } from "@/lib/i18n/mplanipret";
import { verifyDictionary, type I18nIssue } from "@/lib/i18n/runtimeCheck";

type Source = { file: string; dict: Record<string, unknown>; ref: string };

const SOURCES: Source[] = [
  { file: "src/locales/index.ts", dict: translations as unknown as Record<string, unknown>, ref: "fr" },
  { file: "src/lib/i18n/mplanipret.ts", dict: MP_DICT as unknown as Record<string, unknown>, ref: "fr" },
];

function flatten(obj: unknown, prefix = "", out = new Map<string, unknown>()) {
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, path, out);
    else out.set(path, v);
  }
  return out;
}

export default function I18nDiagnostics() {
  const [query, setQuery] = useState("");

  const allowed =
    import.meta.env.DEV ||
    (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug"));

  const data = useMemo(() => {
    return SOURCES.map((src) => {
      const issues: I18nIssue[] = verifyDictionary(src.file, src.dict, src.ref);
      const locales = Object.entries(src.dict).map(([locale, value]) => ({
        locale,
        flat: flatten(value),
      }));
      const keys = new Set<string>();
      locales.forEach((l) => l.flat.forEach((_v, k) => keys.add(k)));
      return { ...src, issues, locales, keys: [...keys].sort() };
    });
  }, []);

  if (!allowed) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Diagnostic i18n disponible en mode développeur uniquement (ajoutez <code>?debug=1</code>).
      </div>
    );
  }

  const q = query.trim().toLowerCase();

  return (
    <div className="min-h-screen bg-background p-6 space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">Diagnostic i18n</h1>
        <p className="text-sm text-muted-foreground">
          État de chargement des dictionnaires, clés manquantes, collisions et recherche de clé.
        </p>
      </header>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Rechercher une clé (ex. nav.accessLog)…"
        className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
      />

      {data.map((src) => {
        const filtered = q ? src.keys.filter((k) => k.toLowerCase().includes(q)) : [];
        return (
          <section key={src.file} className="space-y-3 rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-mono text-sm text-foreground">{src.file}</h2>
              <span className="text-xs text-muted-foreground">référence: {src.ref}</span>
              {src.locales.map((l) => (
                <span key={l.locale} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {l.locale}: {l.flat.size} clés
                </span>
              ))}
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  src.issues.length ? "bg-destructive/15 text-destructive" : "bg-primary/10 text-primary"
                }`}
              >
                {src.issues.length ? `${src.issues.length} problème(s)` : "OK"}
              </span>
            </div>

            {src.issues.length > 0 && (
              <div className="max-h-72 overflow-auto rounded-md border border-border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="p-2">Clé</th>
                      <th className="p-2">Type</th>
                      <th className="p-2">Détail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {src.issues.slice(0, 300).map((i, idx) => (
                      <tr key={idx} className="border-t border-border">
                        <td className="p-2 font-mono text-foreground">{i.key}</td>
                        <td className="p-2 text-muted-foreground">{i.kind}</td>
                        <td className="p-2 text-muted-foreground">{i.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {q && (
              <div className="max-h-80 overflow-auto rounded-md border border-border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="p-2">Clé</th>
                      {src.locales.map((l) => (
                        <th key={l.locale} className="p-2">
                          {l.locale}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, 200).map((k) => (
                      <tr key={k} className="border-t border-border">
                        <td className="p-2 font-mono text-foreground">{k}</td>
                        {src.locales.map((l) => {
                          const v = l.flat.get(k);
                          return (
                            <td key={l.locale} className="p-2 text-muted-foreground">
                              {v === undefined ? (
                                <span className="text-destructive">manquante</span>
                              ) : (
                                String(v)
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {filtered.length === 0 && (
                      <tr>
                        <td className="p-2 text-muted-foreground" colSpan={src.locales.length + 1}>
                          Aucune clé ne correspond.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
