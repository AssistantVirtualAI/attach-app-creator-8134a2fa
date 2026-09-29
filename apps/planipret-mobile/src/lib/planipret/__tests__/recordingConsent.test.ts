import { describe, expect, it } from "vitest";
import { canViewLocalCallMedia } from "../recordingConsent";

describe("recording consent gate", () => {
  it("keeps local call media available before an explicit decision", () => {
    expect(canViewLocalCallMedia(undefined)).toBe(true);
    expect(canViewLocalCallMedia(null)).toBe(true);
    expect(canViewLocalCallMedia("pending")).toBe(true);
    expect(canViewLocalCallMedia("approved")).toBe(true);
  });

  it("hides media once the broker has explicitly deleted the call", () => {
    expect(canViewLocalCallMedia("declined")).toBe(false);
  });
});
