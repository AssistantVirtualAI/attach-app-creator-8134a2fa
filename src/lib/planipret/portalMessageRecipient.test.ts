import { describe, expect, it } from "vitest";
import { normalizePortalMessageRecipient, isInternalMessageRecipient } from "./portalMessageRecipient";

describe("portal message destinations", () => {
  it("accepts authorized extension 113 without converting it to an external number", () => {
    expect(normalizePortalMessageRecipient("113")).toBe("113");
    expect(isInternalMessageRecipient("113")).toBe(true);
  });
  it("keeps DID texting separate from extension chat", () => {
    expect(normalizePortalMessageRecipient("5145550199")).toBe("+15145550199");
    expect(isInternalMessageRecipient("5145550199")).toBe(false);
  });
  it("does not turn invalid short input into an extension", () => {
    expect(normalizePortalMessageRecipient("1")).toBeNull();
    expect(normalizePortalMessageRecipient("113abc")).toBeNull();
  });
});