// Portal and mobile (iOS/Android share one bundle) must ship byte-identical
// commission logic and screens for paid and pending.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FILES = [
  "pages/planipret/mobile/MCommissions.tsx",
  "components/planipret/commissions/PendingCommissionsCard.tsx",
  "components/planipret/mobile/MCommissionCharts.tsx",
  "hooks/useCommissionLive.ts",
  "lib/planipret/ppEdge.ts",
  "components/planipret/commissions/PaidDepositsCard.tsx",
  "pages/planipret/admin/PABrokerCommissions.tsx",
  "pages/planipret/mobile/MBrokerCommissionCharts.tsx",
];

describe("commission parity portal ↔ mobile", () => {
  for (const f of FILES) {
    it(`${f} is identical`, () => {
      const web = readFileSync(resolve(__dirname, "..", f), "utf8");
      const mobile = readFileSync(resolve(__dirname, "../../apps/planipret-mobile/src", f), "utf8");
      expect(mobile).toBe(web);
    });
  }
});
