import { describe, expect, it, vi, beforeEach } from "vitest";

const start = vi.fn();
const browserOpen = vi.fn();
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios" },
  registerPlugin: () => ({ start: (...a: unknown[]) => start(...a) }),
}));
vi.mock("@capacitor/browser", () => ({ Browser: { open: (...a: unknown[]) => browserOpen(...a), close: vi.fn() } }));
const URL_OK = "https://avastatistic.ca/planipret/portal-handoff?th=abc&em=a%40planipret.com&to=%2Fplanipret%2Fbroker";
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }), refreshSession: async () => ({ data: { session: null } }) },
    functions: { invoke: async () => ({ data: { ok: true, url: URL_OK, portal: "broker" }, error: null }) },
  },
}));

import { openBrokerPortal } from "./openBrokerPortal";

describe("openBrokerPortal — iOS presentation", () => {
  beforeEach(() => { start.mockReset(); browserOpen.mockReset(); });

  it("opens the portal in the same secure session window as Microsoft sign-in", async () => {
    start.mockReturnValue(new Promise(() => {}));
    expect(await openBrokerPortal()).toEqual({ ok: true, portal: "broker" });
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ url: URL_OK, ephemeral: false }));
    expect(browserOpen).not.toHaveBeenCalled();
  });

  it("falls back to the in-app browser (popover, no prior close) when iOS refuses", async () => {
    start.mockRejectedValue(new Error("cannot start auth session"));
    browserOpen.mockResolvedValue(undefined);
    expect(await openBrokerPortal("/planipret/broker/marketing")).toEqual({ ok: true, portal: "broker" });
    expect(browserOpen).toHaveBeenCalledWith({ url: URL_OK, presentationStyle: "popover" });
  });
});
