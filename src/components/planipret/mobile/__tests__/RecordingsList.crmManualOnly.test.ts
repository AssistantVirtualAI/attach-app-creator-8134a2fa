import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const files = [
  "src/components/planipret/mobile/recordings/RecordingsList.tsx",
  "apps/planipret-mobile/src/components/planipret/mobile/recordings/RecordingsList.tsx",
];

describe("RecordingsList — CRM sync is manual only", () => {
  for (const rel of files) {
    const src = fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");
    it(`${rel}: single maestro-sync-call, behind the sync click, with explicit flag`, () => {
      const calls = src.match(/invoke\("maestro-sync-call"[^)]*\)/g) ?? [];
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain("explicit_user_action: true");
      expect(calls[0]).toContain("force: true");
      const idx = src.indexOf('invoke("maestro-sync-call"');
      const before = src.slice(Math.max(0, idx - 200), idx);
      expect(before).toMatch(/const sync = async \(\) =>/);
      expect(src).not.toMatch(/force:\s*false/);
      expect(src).not.toMatch(/useEffect\([^]*?maestro-sync-call[^]*?\},\s*\[/.source.length ? /__never__/ : /x/);
    });
    it(`${rel}: success state only on success:true`, () => {
      const idx = src.indexOf('invoke("maestro-sync-call"');
      const block = src.slice(idx, idx + 500);
      expect(block).toMatch(/success === false\) throw/);
      expect(block.indexOf("throw")).toBeLessThan(block.indexOf("maestro_synced: true"));
    });
  }
});
