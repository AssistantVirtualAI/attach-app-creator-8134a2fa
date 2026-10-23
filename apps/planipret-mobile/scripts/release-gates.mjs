#!/usr/bin/env node
/**
 * release-gates.mjs — gates obligatoires avant toute build de release.
 *
 * Usage :
 *   node scripts/release-gates.mjs --pre                 # avant cap sync
 *   node scripts/release-gates.mjs --post --ios          # après sync/archive iOS
 *   node scripts/release-gates.mjs --post --android      # après sync/bundle Android
 *
 * Chaque gate arrête la build au premier échec (exit 1). Aucun artifact
 * n'est produit si un gate échoue. Aucun secret n'est affiché.
 */
import { execSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(APP_DIR, "..", "..");

const args = new Set(process.argv.slice(2));
const PHASE = args.has("--post") ? "post" : "pre";
const WANT_IOS = args.has("--ios");
const WANT_ANDROID = args.has("--android");

let failures = 0;

function gate(name, fn) {
  process.stdout.write(`[gate] ${name} … `);
  try {
    fn();
    process.stdout.write("OK\n");
  } catch (err) {
    failures++;
    process.stdout.write("ÉCHEC\n");
    const msg = String(err?.message ?? err).split("\n").slice(0, 6).join("\n");
    console.error(`[gate:fail] ${name}: ${msg}`);
    process.exit(1); // stop au premier échec
  }
}

function run(cmd, opts = {}) {
  execSync(cmd, { cwd: APP_DIR, stdio: "pipe", ...opts });
}

function runNode(script, extra = []) {
  execFileSync(process.execPath, [path.join(APP_DIR, "scripts", script), ...extra], {
    cwd: APP_DIR,
    stdio: "pipe",
  });
}

// ---------- Gates pré-build ----------

function gateVersions() {
  const pkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, "package.json"), "utf8"));
  if (!/^\d+\.\d+\.\d+$/.test(String(pkg.version ?? ""))) {
    throw new Error(`version invalide dans package.json: ${pkg.version}`);
  }
  const code = Number(pkg.androidVersionCode);
  if (!Number.isInteger(code) || code < 1) {
    throw new Error(`androidVersionCode invalide: ${pkg.androidVersionCode}`);
  }
}

function gateGoogleServicesPackage() {
  const file = path.join(APP_DIR, "android", "app", "google-services.json");
  if (!fs.existsSync(file)) return; // projet natif pas encore généré
  const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  const pkgs = (cfg.client ?? []).flatMap((c) =>
    (c.client_info?.android_client_info?.package_name ? [c.client_info.android_client_info.package_name] : []),
  );
  if (!pkgs.includes("com.planipret.mobile")) {
    throw new Error("google-services.json ne contient pas le package com.planipret.mobile");
  }
}

function gateLemtelIsolation() {
  // L'app Planiprêt ne doit référencer aucun code Lemtel.
  const out = execSync(
    `grep -riIl "lemtel" src capacitor.config.ts package.json 2>/dev/null || true`,
    { cwd: APP_DIR, encoding: "utf8" },
  ).trim();
  if (out) throw new Error(`référence Lemtel détectée dans l'app Planiprêt: ${out.split("\n")[0]}`);
}

const SECRET_PATTERNS = [
  "-----BEGIN PRIVATE KEY-----",
  "-----BEGIN RSA PRIVATE KEY-----",
  "-----BEGIN ENCRYPTED PRIVATE KEY-----",
  "private_key_id",
];

function gateNoSecretsInGit() {
  const tracked = execSync("git ls-files", { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter((f) => !f.startsWith("docs/") && !f.endsWith(".md"));
  for (const f of tracked) {
    const abs = path.join(REPO_ROOT, f);
    try {
      if (fs.statSync(abs).size > 2_000_000) continue;
      const text = fs.readFileSync(abs, "utf8");
      for (const p of SECRET_PATTERNS) {
        if (text.includes(p)) throw new Error(`motif secret « ${p} » trouvé dans ${f}`);
      }
    } catch (err) {
      if (err?.code === "ENOENT" || err?.code === "EISDIR") continue;
      throw err;
    }
  }
}

function gateNpmCi() {
  run("npm ci --no-audit --no-fund");
}

function gateTypescript() {
  const tsconfig = path.join(APP_DIR, "tsconfig.json");
  if (!fs.existsSync(tsconfig)) return;
  run("npx tsc --noEmit -p tsconfig.json");
}

function gateUnitTests() {
  run("npm test -- --run");
}

function gateWebBuild() {
  run("npm run build");
}

function gateParity() {
  runNode("audit-parity.mjs");
}

// ---------- Gates post-build ----------

function gateSipBundle() {
  runNode("verify-sip-bundle.mjs");
}

function gateIosVerify() {
  runNode("ios-verify.mjs");
}

function gateEntitlements() {
  const dir = path.join(APP_DIR, "ios", "App", "App");
  if (!fs.existsSync(dir)) throw new Error("projet iOS absent");
  const ent = fs.readdirSync(dir).filter((f) => f.endsWith(".entitlements"));
  if (!ent.length) throw new Error("aucun fichier .entitlements dans ios/App/App");
  const text = ent.map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
  for (const required of ["aps-environment", "PushKit", "voip"]) {
    if (!text.includes(required)) throw new Error(`entitlement manquant: ${required}`);
  }
}

function gateSigningIos() {
  runNode("verify-signing.mjs", ["--ios"]);
}

function gateSigningAndroid() {
  runNode("verify-signing.mjs", ["--android"]);
}

function gateAndroidVerify() {
  runNode("verify-android.mjs");
}

function gateTargetSdk() {
  const vars = path.join(APP_DIR, "android", "variables.gradle");
  if (!fs.existsSync(vars)) throw new Error("android/variables.gradle absent");
  const text = fs.readFileSync(vars, "utf8");
  const m = /targetSdkVersion\s*=\s*(\d+)/.exec(text);
  if (!m || Number(m[1]) < 34) throw new Error(`targetSdkVersion insuffisant: ${m?.[1] ?? "introuvable"}`);
}

function gateEmbeddedAssets() {
  // Les assets web embarqués doivent provenir du même build que dist/.
  const distIndex = path.join(APP_DIR, "dist", "index.html");
  if (!fs.existsSync(distIndex)) throw new Error("dist/index.html absent — build web manquant");
  const buildId = /VITE_BUILD_ID|build-[0-9a-z]{8,}/i.test(fs.readFileSync(distIndex, "utf8"))
    ? null // l'ID est dans les assets JS; on compare les noms de fichiers à la place
    : null;
  const distAssets = fs.readdirSync(path.join(APP_DIR, "dist", "assets")).filter((f) => f.endsWith(".js") || f.endsWith(".css")).sort();
  const targets = [];
  if (WANT_IOS) targets.push(path.join(APP_DIR, "ios", "App", "App", "public", "assets"));
  if (WANT_ANDROID) targets.push(path.join(APP_DIR, "android", "app", "src", "main", "assets", "public", "assets"));
  for (const t of targets) {
    if (!fs.existsSync(t)) throw new Error(`assets embarqués absents: ${path.relative(APP_DIR, t)}`);
    const embedded = fs.readdirSync(t).filter((f) => f.endsWith(".js") || f.endsWith(".css")).sort();
    const missing = distAssets.filter((f) => !embedded.includes(f));
    if (missing.length) throw new Error(`assets non synchronisés dans ${path.relative(APP_DIR, t)}: ${missing[0]}`);
  }
  void buildId;
}

// ---------- Exécution ----------

console.log(`[release-gates] phase=${PHASE} ios=${WANT_IOS} android=${WANT_ANDROID}`);

if (PHASE === "pre") {
  gate("versions valides (package.json)", gateVersions);
  gate("google-services.json = com.planipret.mobile", gateGoogleServicesPackage);
  gate("isolation Lemtel", gateLemtelIsolation);
  gate("aucun secret tracké dans Git", gateNoSecretsInGit);
  gate("npm ci (lockfile)", gateNpmCi);
  gate("vérification TypeScript", gateTypescript);
  gate("tests unitaires", gateUnitTests);
  gate("build web production", gateWebBuild);
  gate("parité web ↔ mobile", gateParity);
} else {
  gate("bundle SIP vérifié", gateSipBundle);
  if (WANT_IOS) {
    gate("vérification iOS (PJSIP/CallKit)", gateIosVerify);
    gate("entitlements iOS", gateEntitlements);
    gate("signature iOS", gateSigningIos);
  }
  if (WANT_ANDROID) {
    gate("vérification Android", gateAndroidVerify);
    gate("targetSdk ≥ 34", gateTargetSdk);
    gate("google-services.json = com.planipret.mobile", gateGoogleServicesPackage);
    gate("signature Android", gateSigningAndroid);
  }
  gate("assets embarqués identiques au build web", gateEmbeddedAssets);
}

console.log("[release-gates] tous les gates sont passés.");
process.exit(failures ? 1 : 0);
