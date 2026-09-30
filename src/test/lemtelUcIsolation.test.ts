import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const files = [
  ...walk(path.join(root, "src/pages/lemtel-uc")),
  ...walk(path.join(root, "src/components/lemtel-uc")),
  ...["luc-provision", "luc-device", "luc-edge", "luc-pbx-adapter"].map((f) => path.join(root, `supabase/functions/${f}/index.ts`)),
  path.join(root, "supabase/functions/_shared/luc.ts"),
];

describe("Lemtel UC isolation", () => {
  it("never touches Planipret, pbx or legacy lemtel tables", () => {
    for (const f of files) {
      const s = fs.readFileSync(f, "utf8");
      expect(s, f).not.toMatch(/from\(["'`](planipret_|pp_|pbx_|lemtel_)/);
      expect(s, f).not.toMatch(/apps\/planipret-mobile/);
    }
  });
  it("never selects credential ciphertext on the client", () => {
    for (const f of files.filter((x) => x.includes("/src/"))) {
      expect(fs.readFileSync(f, "utf8"), f).not.toMatch(/ciphertext/);
    }
  });
  it("functions never return ciphertext columns", () => {
    for (const f of files.filter((x) => x.includes("functions/luc-"))) {
      const s = fs.readFileSync(f, "utf8");
      for (const m of s.matchAll(/\.select\("([^"]+)"\)/g)) expect(m[1], f).not.toMatch(/ciphertext|\*/);
    }
  });
  it("every tenant-scoped function checks the caller role", () => {
    for (const f of ["luc-provision", "luc-device", "luc-pbx-adapter"]) {
      const s = fs.readFileSync(path.join(root, `supabase/functions/${f}/index.ts`), "utf8");
      expect(s).toMatch(/requireUser/);
      expect(s).toMatch(/hasRole|luc_memberships/);
    }
  });
});
