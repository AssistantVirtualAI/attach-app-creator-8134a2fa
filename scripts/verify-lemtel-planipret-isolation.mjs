import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import process from "node:process";

// Static, read-only verifier. The only process run is read-only local Git inspection.
export const BASE = "a1bd41eba";
export const PHASE15A_END = "87b6b8029";
// Phase 15C: one-time historical compatibility baseline (exact, sorted, frozen).
export const PLANIPRET_COMPATIBILITY_END = "2d933df2f";
export const APPROVED_COMPATIBILITY_PLANIPRET_PATHS = [
  "apps/planipret-mobile/src/pages/planipret/PlanipretMobile.tsx",
  "apps/planipret-mobile/src/pages/planipret/mobile/MCalls.tsx",
  "apps/planipret-mobile/src/pages/planipret/mobile/MContacts.tsx",
  "src/pages/planipret/PlanipretMobile.tsx",
  "src/pages/planipret/broker/PBMarketing.tsx",
  "src/pages/planipret/mobile/MCalls.tsx",
  "src/pages/planipret/mobile/MContacts.tsx",
];
export const USAGE = "LEMTEL_ISOLATION_USAGE: [--base=a1bd41eba]";
export const POLICY = "schemas/lemtel-isolation/planipret-protected-paths-v1.json";
export const SELF = "scripts/verify-lemtel-planipret-isolation.mjs";
export const TEST = "src/test/lemtelPlanipretIsolationPhase15.test.ts";
export const DOC = "docs/lemtel-isolation/phase-15a-planipret-freeze.md";
export const ALLOWED = [POLICY, SELF, TEST, DOC];
export const PREFIXES = ["apps/planipret-mobile/", "src/pages/planipret/", "src/components/planipret/", "src/lib/planipret/", "src/hooks/useMplanipretSoftphone.ts"];
export const PATTERNS = ["**/planipret/**", "**/*planipret*", "**/PpPjsip/**", "**/PpSipKeepAlive/**", "**/PpVoipCall/**"];
export const ROOTS = ["apps/ava-softphone-mobile/", "apps/ava-softphone-desktop/", "src/pages/lemtel/", "src/components/lemtel/", "src/pages/telephony/", "src/components/telephony/", "supabase/functions/", "infra/lemtel-", "services/lemtel-", "schemas/lemtel-", "docs/lemtel-", "scripts/verify-lemtel-", "src/test/lemtel"];
const KEYS = ["schemaVersion", "mode", "protectedPathPrefixes", "protectedPathPatterns", "lemtelAllowedRoots", "policy"];
const READ_ONLY_GIT = ["cat-file", "merge-base", "diff", "diff-index", "ls-files", "rev-parse"];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function checkPolicy(p) {
  return typeof p === "object" && p !== null && !Array.isArray(p)
    && eq(Object.keys(p).sort(), [...KEYS].sort())
    && p.schemaVersion === "lemtel_planipret_protected_paths_v1" && p.mode === "deny"
    && eq(p.protectedPathPrefixes, PREFIXES) && eq(p.protectedPathPatterns, PATTERNS) && eq(p.lemtelAllowedRoots, ROOTS)
    && typeof p.policy === "string" && /never modify Planipr/i.test(p.policy) && /compatibility phase/i.test(p.policy) && /no bulk source copy/i.test(p.policy);
}

// Case-insensitive protected-path test on repository paths only.
export function isProtected(path) {
  const l = path.toLowerCase();
  if (PREFIXES.some((x) => l === x.toLowerCase() || l.startsWith(x.toLowerCase()))) return true;
  const segs = l.split("/"), dirs = segs.slice(0, -1), base = segs[segs.length - 1];
  if (dirs.includes("planipret") || base.includes("planipret")) return true;
  return ["pppjsip", "ppsipkeepalive", "ppvoipcall"].some((d) => dirs.includes(d));
}

const git = (root, args) => {
  if (!READ_ONLY_GIT.includes(args[0])) return null;
  try { return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; }
};
const lines = (s) => s.split("\n").map((x) => x.trim()).filter(Boolean);

const namesFrom = (out) => { const set = new Set(); for (const l of lines(out)) for (const p of l.split("\t").slice(1)) set.add(p); return [...set].sort(); };

// Paths changed between two commits (adds, deletions, modifications; moves as add+delete).
export function committedPaths(root, from, to) {
  const out = git(root, ["diff", "--name-status", "--no-renames", from, to]);
  return out === null ? null : namesFrom(out);
}

// Staged, unstaged and untracked working-tree paths.
export function worktreePaths(root) {
  const tracked = git(root, ["diff-index", "--name-status", "--no-renames", "HEAD"]);
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard"]);
  if (tracked === null || untracked === null) return null;
  return [...new Set([...namesFrom(tracked), ...lines(untracked)])].sort();
}

const isCommit = (root, ref) => { const t = git(root, ["cat-file", "-t", ref]); return t !== null && t.trim() === "commit"; };

export function checkSelf(text) {
  if (new RegExp("write" + "File|append" + "File|mkd" + "ir|rmS" + "ync|unl" + "ink|\\brena" + "me(Sync)?\\s*\\(|cp" + "Sync|createWrite" + "Stream|fet" + "ch\\(|node:(ht" + "tp|ne" + "t|dg" + "ram|dn" + "s|tl" + "s)|\\bspa" + "wn|\\bexec\\(|\\bfo" + "rk\\(|proc" + "ess\\.env").test(text)) return false;
  const imports = [...text.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
  if (!eq(imports, ["node:fs", "node:path", "node:url", "node:child_process", "node:process"])) return false;
  return [...text.matchAll(/\bexecFileSync\s*\(\s*([^,)]*)/g)].every((m) => m[1].trim() === '"git"');
}

export function verify(args, root = process.cwd(), opts = {}) {
  if (args.length > 1 || (args.length === 1 && args[0] !== `--base=${BASE}`)) return { code: 2, stdout: USAGE + "\n" };
  const base = opts.base ?? BASE, end = opts.end ?? PHASE15A_END, compat = opts.compat ?? PLANIPRET_COMPATIBILITY_END, head = opts.head ?? "HEAD";
  const f = [];
  let policy = null;
  try { policy = JSON.parse(readFileSync(join(root, POLICY), "utf8")); } catch { policy = null; }
  if (!checkPolicy(policy)) f.push("POLICY_INVALID");
  // A. Historical Phase 15A integrity: fixed interval base..end only.
  const bOk = isCommit(root, base), eOk = isCommit(root, end);
  if (!bOk) f.push("BASE_MISSING");
  if (!eOk) f.push("END_MISSING");
  let rangeOk = bOk && eOk;
  if (rangeOk && git(root, ["merge-base", "--is-ancestor", base, end]) === null) { f.push("BASE_NOT_ANCESTOR"); rangeOk = false; }
  if (rangeOk && git(root, ["merge-base", "--is-ancestor", end, head]) === null) { f.push("END_NOT_ANCESTOR"); rangeOk = false; }
  if (rangeOk) {
    const hist = committedPaths(root, base, end);
    if (hist === null) f.push("GIT_READ_FAILED");
    else {
      if (hist.some((p) => !ALLOWED.includes(p) && isProtected(p))) f.push("PLANIPRET_PATH_CHANGED");
      if (!eq(hist, [...ALLOWED].sort())) f.push("HISTORICAL_SCOPE_EXACT");
    }
    // B. Phase 15C one-time compatibility interval: end..compat must contain exactly the approved paths.
    if (!isCommit(root, compat)) { f.push("COMPATIBILITY_END_MISSING"); rangeOk = false; }
    else if (git(root, ["merge-base", "--is-ancestor", end, compat]) === null || git(root, ["merge-base", "--is-ancestor", compat, head]) === null) { f.push("COMPATIBILITY_NOT_ANCESTOR"); rangeOk = false; }
    else {
      const cp = committedPaths(root, end, compat);
      if (cp === null) f.push("GIT_READ_FAILED");
      else if (!eq(cp.filter((p) => !ALLOWED.includes(p) && isProtected(p)), APPROVED_COMPATIBILITY_PLANIPRET_PATHS)) f.push("PLANIPRET_COMPATIBILITY_SCOPE_EXACT");
    }
  }
  if (rangeOk) {
    // C. Permanent global guard: commits strictly after the compatibility cutoff and current working tree.
    const later = committedPaths(root, compat, head);
    const wt = worktreePaths(root);
    if (later === null || wt === null) f.push("GIT_READ_FAILED");
    else {
      if (later.some((p) => !ALLOWED.includes(p) && isProtected(p)) && !f.includes("PLANIPRET_PATH_CHANGED")) f.push("PLANIPRET_PATH_CHANGED");
      if (wt.some((p) => !ALLOWED.includes(p) && isProtected(p))) f.push("PLANIPRET_WORKTREE_CHANGED");
    }
  }
  let self = null;
  try { self = readFileSync(join(root, SELF), "utf8"); } catch { self = null; }
  if (self === null || !checkSelf(self)) f.push("VERIFIER_CAPABILITY");
  if (f.length) return { code: 1, stdout: [...new Set(f)].map((x) => `LEMTEL_ISOLATION_FAILED: ${x}`).join("\n") + "\n" };
  return { code: 0, stdout: "LEMTEL_ISOLATION_PASSED\n" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const r = verify(process.argv.slice(2), resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  process.stdout.write(r.stdout);
  process.exitCode = r.code;
}
