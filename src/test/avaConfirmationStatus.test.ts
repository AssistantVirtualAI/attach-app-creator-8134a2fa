import { describe, it, expect } from "vitest";
import { displayStatus } from "@/lib/planipret/avaConfirmationStatus";
import { describeVoiceStartError } from "@/lib/planipret/avaVoiceFailure";
const now = Date.parse("2026-10-30T02:00:00Z");
describe("AVA confirmation display status", () => {
  it("pending older than 24h is expired", () => expect(displayStatus({ status: "pending", created_at: "2026-09-15T18:34:00Z" }, now)).toBe("expired"));
  it("recent pending stays pending", () => expect(displayStatus({ status: "pending", created_at: "2026-10-30T01:00:00Z" }, now)).toBe("pending"));
  it("action_in_progress is duplicate blocked", () => expect(displayStatus({ status: "failed", error_code: "action_in_progress", created_at: "2026-10-29T22:44:00Z" }, now)).toBe("duplicate_blocked"));
  it("pre-fix email recipient failure is fixed_since", () => expect(displayStatus({ status: "failed", error_code: "to, subject, body requis", created_at: "2026-10-29T23:48:00Z" }, now)).toBe("fixed_since"));
});
describe("voice start error detail", () => {
  it("redacts jwt and names mic denial", () => {
    expect(describeVoiceStartError({ name: "Error", message: "bad eyJa.b.c" })).not.toContain("eyJa");
    expect(describeVoiceStartError({ name: "NotAllowedError" })).toBe("microphone_denied");
  });
});
