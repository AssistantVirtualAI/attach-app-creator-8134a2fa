import { describe, expect, it } from "vitest";
import { describeMsAuthError } from "@/components/planipret/broker/BrokerAuthScreen";

describe("describeMsAuthError", () => {
  it("returns null without an error", () => {
    expect(describeMsAuthError(null, "fr")).toBeNull();
  });
  it("explains a cancelled sign-in", () => {
    expect(describeMsAuthError("access_denied", "fr")).toContain("annulée");
    expect(describeMsAuthError("AADSTS50000 access_denied", "en")).toContain("cancelled");
  });
  it("explains a non-planipret account", () => {
    expect(describeMsAuthError("domain not allowed", "fr")).toContain("@planipret");
  });
  it("falls back to the raw message", () => {
    expect(describeMsAuthError("boom", "en")).toContain("boom");
  });
});
