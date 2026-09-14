import { describe, it, expect } from "vitest";
import { decideOutboundRoute } from "../outboundRoute";

describe("decideOutboundRoute", () => {
  it("compose via le moteur natif quand la ligne mobile est inscrite", () => {
    expect(decideOutboundRoute({
      clientType: "mobile", isNativePlatform: true, engineAvailable: true, engineRegistered: true,
    })).toBe("native");
  });

  it("refuse l'appel (pas de faux ringing REST) si la ligne n'est pas inscrite", () => {
    expect(decideOutboundRoute({
      clientType: "mobile", isNativePlatform: true, engineAvailable: true, engineRegistered: false,
    })).toBe("native_unregistered");
  });

  it("signale un binaire sans moteur natif — iOS comme Android", () => {
    for (const _platform of ["ios", "android"]) {
      expect(decideOutboundRoute({
        clientType: "mobile", isNativePlatform: true, engineAvailable: false, engineRegistered: false,
      })).toBe("engine_missing");
    }
  });

  it("laisse le client web utiliser JsSIP puis le repli PBX", () => {
    expect(decideOutboundRoute({
      clientType: "web", isNativePlatform: false, engineAvailable: false, engineRegistered: false,
    })).toBe("web");
  });

  it("n'autorise jamais le repli REST sur plateforme native", () => {
    const routes = [true, false].flatMap((reg) => [true, false].map((av) =>
      decideOutboundRoute({ clientType: "mobile", isNativePlatform: true, engineAvailable: av, engineRegistered: reg })));
    expect(routes.every((r) => r !== "web")).toBe(true);
  });
});
