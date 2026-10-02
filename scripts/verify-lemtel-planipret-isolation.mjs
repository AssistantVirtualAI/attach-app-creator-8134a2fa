import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import process from "node:process";

// Static, read-only verifier. The only process run is read-only local Git inspection.
export const BASE = "a1bd41eba";
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
const READ_ONLY_GIT = ["cat-file", "merge-base", "diff", "ls-files", "rev-parse"];
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

// All paths touched between base and end (adds, copies, moves as add+delete via --no-renames flag, modifications, deletions), plus worktree changes.
export function changes(root, base, end) {
  const committed = git(root, ["diff", "--name-status", "--no-renames", base, end]);
  const worktree = end === "HEAD" ? git(root, ["diff", "--name-status", "--no-renames", "HEAD"]) : "";
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard"]);
  if (committed === null || worktree === null || untracked === null) return null;
  const paths = new Set();
  for (const l of lines(committed + "\n" + worktree)) for (const p of l.split("\t").slice(1)) paths.add(p);
  return { paths: [...paths].sort(), untracked: lines(untracked) };
}

export function checkSelf(text) {
  if (new RegExp("write" + "File|append" + "File|mkd" + "ir|rmS" + "ync|unl" + "ink|rena" + "me|cp" + "Sync|createWrite" + "Stream|fet" + "ch\\(|node:(ht" + "tp|ne" + "t|dg" + "ram|dn" + "s|tl" + "s)|\\bspa" + "wn|\\bexec\\(|\\bfo" + "rk\\(|proc" + "ess\\.env").test(text)) return false;
  const imports = [...text.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
  if (!eq(imports, ["node:fs", "node:path", "node:url", "node:child_process", "node:process"])) return false;
  return [...text.matchAll(/\bexecFileSync\s*\(\s*([^,)]*)/g)].every((m) => m[1].trim() === '"git"');
}

export function verify(args, root = process.cwd(), opts = {}) {
  if (args.length > 1 || (args.length === 1 && args[0] !== `--base=${BASE}`)) return { code: 2, stdout: USAGE + "\n" };
  const base = opts.base ?? BASE, end = opts.end ?? "HEAD";
  const f = [];
  let policy = null;
  try { policy = JSON.parse(readFileSync(join(root, POLICY), "utf8")); } catch { policy = null; }
  if (!checkPolicy(policy)) f.push("POLICY_INVALID");
  const bt = git(root, ["cat-file", "-t", base]);
  if (bt === null || bt.trim() !== "commit") f.push("BASE_MISSING");
  else if (git(root, ["merge-base", "--is-ancestor", base, end]) === null) f.push("BASE_NOT_ANCESTOR");
  const ch = changes(root, base, end);
  if (!ch) f.push("GIT_READ_FAILED");
  else {
    const all = [...new Set([...ch.paths, ...ch.untracked])];
    if (all.some((p) => !ALLOWED.includes(p) && isProtected(p))) f.push("PLANIPRET_PATH_CHANGED");
    if (all.some((p) => !ALLOWED.includes(p))) f.push("OUTSIDE_ALLOWLIST");
    if (ch.untracked.some((p) => !ALLOWED.includes(p))) f.push("UNTRACKED_FILE");
  }
  let self = null;
  try { self = readFileSync(join(root, SELF), "utf8"); } catch { self = null; }
  if (self === null || !checkSelf(self)) f.push("VERIFIER_CAPABILITY");
  if (f.length) return { code: 1, stdout: f.map((x) => `LEMTEL_ISOLATION_FAILED: ${x}`).join("\n") + "\n" };
  return { code: 0, stdout: "LEMTEL_ISOLATION_PASSED\n" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const r = verify(process.argv.slice(2), resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  process.stdout.write(r.stdout);
  process.exitCode = r.code;
}
