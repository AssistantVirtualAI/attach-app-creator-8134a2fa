#!/usr/bin/env node
/**
 * GRANT audit report.
 *
 * Lists every migration that creates a table in `public` WITHOUT a GRANT in the
 * same file (the ⚠️ warnings printed by scripts/security-gate.mjs), and shows
 * which later migration(s) actually granted access to that table.
 *
 * Usage:
 *   node scripts/grant-audit.mjs              # print + write reports/grant-audit.md
 *   node scripts/grant-audit.mjs --quiet      # write file only (short summary)
 *   node scripts/grant-audit.mjs --out <path>
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const GRANT_RULE_BASELINE = "20260818";

const argv = process.argv.slice(2);
const quiet = argv.includes("--quiet");
const outIdx = argv.indexOf("--out");
const OUT = resolve(ROOT, outIdx >= 0 ? argv[outIdx + 1] : "reports/grant-audit.md");

function files() {
  if (!existsSync(MIGRATIONS)) return [];
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join(MIGRATIONS, f));
}

const grantOn = (table) =>
  new RegExp(`grant\\s+([\\s\\S]{0,120}?)\\s+on\\s+(?:table\\s+)?public\\.\"?${table}\"?`, "gi");

const all = files().map((file) => ({
  file,
  name: basename(file),
  rel: file.replace(ROOT + "/", ""),
  sql: readFileSync(file, "utf8"),
}));

/** @type {{table:string, rel:string, name:string, baselineViolation:boolean, fixes:{rel:string,roles:string[]}[]}[]} */
const findings = [];

for (const mig of all) {
  const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.("?[\w]+"?)/gi;
  let m;
  const seen = new Set();
  while ((m = createRe.exec(mig.sql))) {
    const table = m[1].replace(/"/g, "");
    if (seen.has(table)) continue;
    seen.add(table);
    if (grantOn(table).test(mig.sql)) continue;

    // Find later migrations that grant on this table.
    const fixes = [];
    for (const later of all) {
      if (later.name <= mig.name) continue;
      const roles = new Set();
      let g;
      const re = grantOn(table);
      while ((g = re.exec(later.sql))) {
        const tail = later.sql.slice(g.index, g.index + 400);
        const to = /\bto\s+([^;\n]+)/i.exec(tail);
        if (to) to[1].split(",").forEach((r) => roles.add(r.trim().toLowerCase()));
        else roles.add("(rôle non détecté)");
      }
      if (/grant\s+[\s\S]{0,80}on\s+all\s+tables\s+in\s+schema\s+public/i.test(later.sql) || /execute\s+format\([^)]*grant/i.test(later.sql)) {
        roles.add("(GRANT global/boucle)");
      }
      if (roles.size) fixes.push({ rel: later.rel, roles: [...roles] });
    }

    findings.push({
      table,
      rel: mig.rel,
      name: mig.name,
      baselineViolation: mig.name >= GRANT_RULE_BASELINE,
      fixes,
    });
  }
}

const fixed = findings.filter((f) => f.fixes.length);
const unfixed = findings.filter((f) => !f.fixes.length);

const lines = [];
lines.push("# Audit des GRANT sur les migrations");
lines.push("");
lines.push(`_Généré le ${new Date().toISOString()}_`);
lines.push("");
lines.push(`- Tables créées sans GRANT dans la même migration : **${findings.length}**`);
lines.push(`- Corrigées par une migration ultérieure : **${fixed.length}**`);
lines.push(`- Sans GRANT trouvé dans aucune migration : **${unfixed.length}**`);
lines.push(
  `- Postérieures à la baseline ${GRANT_RULE_BASELINE} (bloquantes) : **${findings.filter((f) => f.baselineViolation && !f.fixes.length).length}**`,
);
lines.push("");

lines.push("## ✅ GRANT ajoutés plus tard");
lines.push("");
if (!fixed.length) lines.push("_Aucune._");
else {
  lines.push("| Table | Migration de création | GRANT ajouté par | Rôles |");
  lines.push("| --- | --- | --- | --- |");
  for (const f of fixed) {
    const first = f.fixes[0];
    const extra = f.fixes.length > 1 ? ` (+${f.fixes.length - 1})` : "";
    lines.push(
      `| \`public.${f.table}\` | \`${basename(f.rel)}\` | \`${basename(first.rel)}\`${extra} | ${first.roles.join(", ")} |`,
    );
  }
}
lines.push("");

lines.push("## ❗ Aucun GRANT trouvé");
lines.push("");
if (!unfixed.length) lines.push("_Aucune — toutes les tables ont reçu leurs GRANT._");
else {
  lines.push("| Table | Migration de création | Bloquant (post-baseline) |");
  lines.push("| --- | --- | --- |");
  for (const f of unfixed) {
    lines.push(`| \`public.${f.table}\` | \`${basename(f.rel)}\` | ${f.baselineViolation ? "oui" : "non (héritée)"} |`);
  }
}
lines.push("");

const report = lines.join("\n");
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, report, "utf8");

if (!quiet) console.log(report);
console.log(
  `\n📄 Rapport GRANT écrit dans ${OUT.replace(ROOT + "/", "")} — ${findings.length} avertissement(s), ${fixed.length} corrigé(s) plus tard, ${unfixed.length} sans GRANT.`,
);

// Informational only: the security gate remains the blocking check.
process.exit(0);
