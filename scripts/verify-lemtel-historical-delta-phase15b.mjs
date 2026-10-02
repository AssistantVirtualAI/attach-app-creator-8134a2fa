import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import process from "node:process";
import { isProtected } from "./verify-lemtel-planipret-isolation.mjs";

// Static, read-only verifier for the review-only Phase 15B inventory. Only read-only local Git inspection is run.
export const BASE = "87b6b8029";
export const USAGE = "LEMTEL_P15B_USAGE: [--base=87b6b8029]";
export const DOC = "docs/lemtel-isolation/phase-15b-historical-mobile-delta-inventory.md";
export const SELF = "scripts/verify-lemtel-historical-delta-phase15b.mjs";
export const TEST = "src/test/lemtelHistoricalDeltaPhase15B.test.ts";
export const ALLOWED = [DOC, SELF, TEST];
const READ_ONLY_GIT = ["cat-file", "merge-base", "diff", "ls-files"];
const CATEGORIES = ["CURRENT_SUPERSEDES_HISTORICAL", "HISTORICAL_OBSOLETE_DO_NOT_PORT", "CANDIDATE_FOR_TARGETED_REVIEW"];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const git = (root, args) => {
  if (!READ_ONLY_GIT.includes(args[0])) return null;
  try { return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; }
};
const lines = (s) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export const isAppOrBackend = (p) => /^(apps|supabase)\//i.test(p);
export const isHistoricalCopy = (p) => /(^|\/)(lemtel_historical[^/]*|historical[-_]?(mobile|source|copy)?|attach-app-creator[^/]*)(\/|$)/i.test(p);

export function changes(root, base, end) {
  const committed = git(root, ["diff", "--name-status", "--no-renames", base, end]);
  const worktree = end === "HEAD" ? git(root, ["diff", "--name-status", "--no-renames", "HEAD"]) : "";
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard"]);
  if (committed === null || worktree === null || untracked === null) return null;
  const paths = new Set();
  for (const l of lines(committed + "\n" + worktree)) for (const p of l.split("\t").slice(1)) paths.add(p);
  return { paths: [...paths].sort(), untracked: lines(untracked) };
}

export function checkDoc(t) {
  return typeof t === "string" && /Lemtel Softphone/.test(t) && /com\.lemtel\.softphone/.test(t) && /com\.assistantvirtualai\.softphone/.test(t)
    && CATEGORIES.every((c) => t.includes(c))
    && ["SIP registration", "Incoming call UI", "Android foreground", "iOS CallKit", "Credential loading", "CDR", "Native plugins", "Store identity", "Diagnostics"].every((s) => t.includes(s))
    && /current app remains authoritative/i.test(t) && /no historical source is copied/i.test(t);
}

export function checkSelf(text) {
  if (new RegExp("write" + "File|append" + "File|mkd" + "ir|rmS" + "ync|unl" + "ink|\\brena" + "me(Sync)?\\s*\\(|cp" + "Sync|createWrite" + "Stream|fet" + "ch\\(|node:(ht" + "tp|ne" + "t|dg" + "ram|dn" + "s|tl" + "s)|\\bspa" + "wn|\\bexec\\(|\\bfo" + "rk\\(|proc" + "ess\\.env").test(text)) return false;
  const imports = [...text.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
  if (!eq(imports, ["node:fs", "node:path", "node:url", "node:child_process", "node:process", "./verify-lemtel-planipret-isolation.mjs"])) return false;
  return [...text.matchAll(/\bexecFileSync\s*\(\s*([^,)]*)/g)].every((m) => m[1].trim() === '"git"');
}

export function verify(args, root = process.cwd(), opts = {}) {
  if (args.length > 1 || (args.length === 1 && args[0] !== `--base=${BASE}`)) return { code: 2, stdout: USAGE + "\n" };
  const base = opts.base ?? BASE, end = opts.end ?? "HEAD";
  const f = [];
  const bt = git(root, ["cat-file", "-t", base]);
  if (bt === null || bt.trim() !== "commit") f.push("BASE_MISSING");
  else if (git(root, ["merge-base", "--is-ancestor", base, end]) === null) f.push("BASE_NOT_ANCESTOR");
  const ch = changes(root, base, end);
  if (!ch) f.push("GIT_READ_FAILED");
  else {
    const all = [...new Set([...ch.paths, ...ch.untracked])].filter((p) => !ALLOWED.includes(p));
    if (all.some(isProtected)) f.push("PLANIPRET_PATH_CHANGED");
    if (all.some(isAppOrBackend)) f.push("APP_OR_BACKEND_CHANGED");
    if (all.some(isHistoricalCopy)) f.push("HISTORICAL_COPY");
    if (all.length) f.push("OUTSIDE_ALLOWLIST");
    if (ch.untracked.some((p) => !ALLOWED.includes(p))) f.push("UNTRACKED_FILE");
  }
  const rd = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return null; } };
  if (!checkDoc(rd(DOC))) f.push("INVENTORY_INCOMPLETE");
  const self = rd(SELF);
  if (self === null || !checkSelf(self)) f.push("VERIFIER_CAPABILITY");
  if (f.length) return { code: 1, stdout: f.map((x) => `LEMTEL_P15B_FAILED: ${x}`).join("\n") + "\n" };
  return { code: 0, stdout: "LEMTEL_P15B_PASSED\n" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const r = verify(process.argv.slice(2), resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  process.stdout.write(r.stdout);
  process.exitCode = r.code;
}
