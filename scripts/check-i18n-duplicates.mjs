#!/usr/bin/env node
/**
 * Détecte les clés dupliquées dans les objets i18n avant compilation.
 * Sortie CI explicite : fichier, ligne, colonne et clé en collision.
 *
 * Usage: node scripts/check-i18n-duplicates.mjs [globRoots...]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOTS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["src/lib/i18n", "src/locales", "apps/planipret-mobile/src/lib/i18n", "apps/planipret-mobile/src/locales"];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function keyName(prop) {
  const name = prop.name;
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null; // computed key: ignoré
}

const findings = [];

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const source = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);

    const visit = (node) => {
      if (ts.isObjectLiteralExpression(node)) {
        const seen = new Map();
        for (const prop of node.properties) {
          if (ts.isSpreadAssignment(prop)) continue;
          const key = keyName(prop);
          if (!key) continue;
          if (seen.has(key)) {
            const { line, character } = sf.getLineAndCharacterOfPosition(prop.getStart(sf));
            const first = seen.get(key);
            findings.push({
              file: relative(process.cwd(), file),
              key,
              line: line + 1,
              column: character + 1,
              firstLine: first + 1,
            });
          } else {
            const { line } = sf.getLineAndCharacterOfPosition(prop.getStart(sf));
            seen.set(key, line);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
}

/** Lien cliquable vers la ligne exacte (GitHub) ou chemin local sinon. */
function sourceLink(f) {
  const repo = process.env.GITHUB_REPOSITORY;
  const sha = process.env.GITHUB_SHA;
  if (repo && sha) return `https://github.com/${repo}/blob/${sha}/${f.file}#L${f.line}`;
  return `file://${join(process.cwd(), f.file)}:${f.line}:${f.column}`;
}

if (findings.length) {
  console.error(`\n✖ i18n duplicate keys detected (${findings.length}):\n`);
  for (const f of findings) {
    const msg = `${f.file}:${f.line}:${f.column} — duplicate key "${f.key}" (first defined at line ${f.firstLine})`;
    console.error(`  - ${msg}`);
    console.error(`    source: ${sourceLink(f)}`);
    // Annotation GitHub Actions: fichier + ligne + colonne + clé visibles dans le job log
    if (process.env.GITHUB_ACTIONS) {
      console.error(
        `::error file=${f.file},line=${f.line},col=${f.column},title=Duplicate i18n key "${f.key}"::${msg} — ${sourceLink(f)}`,
      );
    }
  }
  console.error("\nCorrigez ces collisions avant de compiler (TS1117).\n");
  process.exit(1);
}

console.log("✓ i18n duplicate key check passed");
