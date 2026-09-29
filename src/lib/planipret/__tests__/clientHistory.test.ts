import { describe, expect, it } from "vitest";
import { shouldOfferMaestroClientCreation } from "../clientHistory";

describe("client creation action", () => {
  it("offers creation for an external caller even when caller ID has a name", () => {
    expect(shouldOfferMaestroClientCreation({ phone: "+1 514 555 0123", maestroClientId: null })).toBe(true);
  });

  it("never offers creation when the call is already linked to Maestro", () => {
    expect(shouldOfferMaestroClientCreation({ phone: "+1 514 555 0123", maestroClientId: "511" })).toBe(false);
  });

  it("never offers creation for an internal extension", () => {
    expect(shouldOfferMaestroClientCreation({ phone: "1136", maestroClientId: null })).toBe(false);
  });
});
