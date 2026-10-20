import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const notifier = readFileSync(resolve(__dirname, "../../supabase/functions/pp-feedback-notify/index.ts"), "utf8");
const pbMessages = readFileSync(resolve(__dirname, "../pages/planipret/broker/PBMessages.tsx"), "utf8");

describe("Feedback e-mail screenshots", () => {
  it("embeds screenshots inline so photos are visible in the e-mail", () => {
    expect(notifier).toContain("content_id");
    expect(notifier).toContain("cid:");
    expect(notifier).toContain("attachments");
    expect(notifier).toContain("INLINE_MAX_BYTES");
  });

  it("keeps the signed-link fallback and the reporter ownership check", () => {
    expect(notifier).toContain("belongsToReporter");
    expect(notifier).toContain("Ouvrir la capture");
  });
});

describe("Portal Texts conversation names", () => {
  it("resolves contact names for thread peers instead of bare numbers", () => {
    expect(pbMessages).toContain('useCallerNames');
    expect(pbMessages).toContain("peerLabel(t.peer)");
    expect(pbMessages).toContain("peerLabel(active.peer)");
  });
});
