import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildAvaFirstMessage, buildAvaPrompt } from "../../supabase/functions/_shared/ava-prompt";

const p = { full_name: "Karl Tremblay", extension: "1142", maestro_connected: true };

describe("AVA prompt parity (runtime = preview)", () => {
  it("greets warmly with the broker's first name", () => {
    expect(buildAvaFirstMessage("Karl Tremblay", "fr")).toBe("Salut Karl ! C'est AVA, contente de t'entendre. Qu'est-ce que je peux faire pour toi aujourd'hui ?");
    expect(buildAvaFirstMessage("Karl Tremblay", "en")).toBe("Hi Karl! AVA here, happy to hear from you. What can I do for you today?");
  });
  it("keeps mandatory confirmation and real-result rules", () => {
    const s = buildAvaPrompt(p, "fr");
    expect(s).toContain("Dis oui pour confirmer ou non pour annuler.");
    expect(s).toContain("result.success === true");
    expect(s).toContain("Traite une seule action sensible à la fois");
    expect(s).toContain('notification_status === "sent"');
  });
  it("runtime and preview both use the shared builder, no stale greeting", () => {
    for (const f of ["ava-agent-config", "ava-agent-config-preview"]) {
      const src = readFileSync(`supabase/functions/${f}/index.ts`, "utf8");
      expect(src).toContain("buildAvaPrompt(p, lang)");
      expect(src).toContain("buildAvaFirstMessage(p.full_name, lang)");
      expect(src).not.toContain("Je suis AVA, ton assistante IA");
    }
  });
});
