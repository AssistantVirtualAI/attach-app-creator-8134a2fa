import { describe, it, expect } from "vitest";
import { isPortalAvaAllowed } from "./PortalAvaLauncher";

describe("portal AVA access", () => {
  it("shows AVA only when the profile is explicitly enabled", () => {
    expect(isPortalAvaAllowed({ portal_ava_enabled: true })).toBe(true);
  });
  it("hides AVA for every other profile", () => {
    expect(isPortalAvaAllowed({ portal_ava_enabled: false })).toBe(false);
    expect(isPortalAvaAllowed({})).toBe(false);
    expect(isPortalAvaAllowed(null)).toBe(false);
  });
});
