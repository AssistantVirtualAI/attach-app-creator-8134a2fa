import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({
  handlers: new Map<string, (p: any) => void>(),
  created: [] as string[],
  removeChannel: vi.fn(),
  navigate: vi.fn(),
  search: "",
  openAuth: vi.fn(async () => {}),
  buildUrl: vi.fn(async () => "https://login.microsoftonline.com/x"),
  getSession: vi.fn(async () => ({ data: { session: null } })),
  invoke: vi.fn(async () => ({ data: { success: true }, error: null })),
  verifier: "v" as string | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: (name: string) => {
      h.created.push(name.split(":")[1]);
      const ch: any = { name, on: (_e: string, f: any, cb: any) => { h.handlers.set(`${name}|${f.table}|${f.event}`, cb); return ch; }, subscribe: () => ch };
      return ch;
    },
    removeChannel: h.removeChannel,
    functions: { invoke: h.invoke },
    auth: { getSession: h.getSession, getUser: vi.fn(async () => ({ data: { user: null } })), verifyOtp: vi.fn() },
  },
}));
vi.mock("react-router-dom", () => ({
  useNavigate: () => h.navigate,
  useSearchParams: () => [new URLSearchParams(h.search)],
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@capacitor/browser", () => ({ Browser: { close: vi.fn(async () => {}) } }));
vi.mock("@/lib/ms365OAuth", () => ({
  openMs365Authorize: h.openAuth,
  buildMs365AuthorizeUrl: h.buildUrl,
  clearRememberedMs365RedirectUri: vi.fn(),
  getRememberedMs365CodeVerifierAsync: vi.fn(async () => h.verifier),
  getRememberedMs365RedirectUriAsync: vi.fn(async () => "pp://cb"),
}));
vi.mock("@/lib/ms365Pending", () => ({ clearMs365Pending: vi.fn() }));
vi.mock("@/lib/ms365CallbackStore", () => ({
  clearMs365CallbackUrl: vi.fn(async () => {}),
  recoverMs365CallbackParams: vi.fn(async (p: URLSearchParams) => ({ code: p.get("code"), error: p.get("error"), state: p.get("state") })),
}));
vi.mock("@/lib/ms365AuthLogin", () => ({
  clearMicrosoftSignInIntentAsync: vi.fn(async () => {}),
  getMicrosoftSignInIntentAsync: vi.fn(async () => null),
  getMicrosoftSignInNextAsync: vi.fn(async (d: string) => d),
}));
vi.mock("@/lib/deepLinkDebug", () => ({ markOAuthCallbackCompleted: vi.fn() }));

import { useRealtimeManager, realtimeManagerStats } from "@/hooks/useRealtimeManager";
import { startMs365Authorize } from "@/lib/planipret/ms365Start";
import { rememberMs365ReturnTo } from "@/lib/planipret/ms365ReturnTo";
import Ms365Callback from "@/pages/planipret/Ms365Callback";

const KEY = "pp_ms365_return_to_v1";
const stored = () => localStorage.getItem(KEY);

describe("ms365 OAuth departures remember a safe internal return", () => {
  beforeEach(() => { localStorage.clear(); h.openAuth.mockClear(); h.buildUrl.mockClear(); });
  for (const path of ["/mplanipret/more", "/mplanipret/connections", "/mplanipret/ms365-diagnostics"]) {
    it(`from ${path}`, async () => {
      window.history.replaceState(null, "", path);
      await startMs365Authorize({ clientId: "c", tenant: "t" }, path.endsWith("diagnostics") ? "redirect" : "open");
      expect(JSON.parse(stored()!).path).toBe(path);
    });
  }
  it("non-whitelisted current route stores nothing", async () => {
    window.history.replaceState(null, "", "/mplanipret/calls");
    await startMs365Authorize({ clientId: "c", tenant: "t" });
    expect(stored()).toBeNull();
    expect(h.openAuth).toHaveBeenCalledTimes(1);
  });
});

async function runCallback(search: string) {
  h.search = search;
  render(<Ms365Callback />);
  await waitFor(() => expect(h.navigate).toHaveBeenCalled());
  return h.navigate.mock.calls[0];
}

describe("ms365 callback exits", () => {
  beforeEach(() => {
    localStorage.clear(); h.navigate.mockReset(); h.verifier = "v";
    h.getSession.mockResolvedValue({ data: { session: { access_token: "t" } } } as any);
    h.invoke.mockResolvedValue({ data: { success: true }, error: null } as any);
  });
  for (const path of ["/mplanipret/more", "/mplanipret/connections", "/mplanipret/ms365-diagnostics"]) {
    it(`success returns to ${path} with replace`, async () => {
      rememberMs365ReturnTo(path);
      const [to, opts] = await runCallback(`?code=ok-${path}&state=s`);
      expect(to).toBe(`${path}?ms365=ok`); expect(opts).toEqual({ replace: true }); expect(stored()).toBeNull();
    });
  }
  it("stale destination falls back to Home", async () => {
    rememberMs365ReturnTo("/mplanipret/more", Date.now() - 31 * 60_000);
    expect((await runCallback("?code=stale&state=s"))[0]).toBe("/mplanipret/home?ms365=ok");
  });
  it("external / malformed stored destination falls back to Home", async () => {
    localStorage.setItem(KEY, JSON.stringify({ path: "https://evil.example", at: Date.now() }));
    expect((await runCallback("?code=ext&state=s"))[0]).toBe("/mplanipret/home?ms365=ok");
  });
  it("cancel (no code) clears the destination", async () => {
    rememberMs365ReturnTo("/mplanipret/more");
    const [to, opts] = await runCallback("?state=s");
    expect(to).toBe("/mplanipret/home"); expect(opts).toEqual({ replace: true }); expect(stored()).toBeNull();
  });
  it("missing verifier clears the destination", async () => {
    h.verifier = null; rememberMs365ReturnTo("/mplanipret/more");
    expect((await runCallback("?code=nov&state=s"))[0]).toBe("/mplanipret/home"); expect(stored()).toBeNull();
  });
  it("OAuth error clears the destination", async () => {
    rememberMs365ReturnTo("/mplanipret/more");
    await runCallback("?error=access_denied");
    expect(stored()).toBeNull();
  });
  it("exchange failure clears the destination", async () => {
    h.invoke.mockResolvedValue({ data: { success: false }, error: { message: "boom" } } as any);
    rememberMs365ReturnTo("/mplanipret/more");
    await runCallback("?code=fail&state=s");
    expect(stored()).toBeNull();
  });
  it("anti-replay (code already processed) clears the destination", async () => {
    rememberMs365ReturnTo("/mplanipret/more");
    await runCallback("?code=replay&state=s");
    h.navigate.mockReset(); rememberMs365ReturnTo("/mplanipret/more");
    const [to] = await runCallback("?code=replay&state=s");
    expect(to).toBe("/mplanipret/home"); expect(stored()).toBeNull();
  });
});

describe("realtime manager lifecycle", () => {
  beforeEach(() => { h.created.length = 0; h.handlers.clear(); h.removeChannel.mockClear(); realtimeManagerStats.created = 0; realtimeManagerStats.removed = 0; });
  const fire = (user: string, table: string, event: string, p: any) => {
    for (const [k, cb] of h.handlers) if (k.includes(`:${user}:`) && k.endsWith(`|${table}|${event}`)) cb(p);
  };
  it("user A -> B: A removed exactly once, B created exactly once", () => {
    function S({ u }: { u: string }) { useRealtimeManager(u); return null; }
    const r = render(<S u="A" />);
    r.rerender(<S u="B" />);
    expect(h.created).toEqual(["A", "B"]);
    expect(h.removeChannel).toHaveBeenCalledTimes(1);
    r.unmount();
    expect(h.removeChannel).toHaveBeenCalledTimes(2);
  });
  it("only the latest callback fires; one delivery during re-render", () => {
    const first = vi.fn(); const latest = vi.fn();
    function S({ cb }: { cb: any }) { useRealtimeManager("U", { onInboundRinging: cb }); return null; }
    const r = render(<S cb={first} />);
    r.rerender(<S cb={latest} />);
    act(() => { fire("U", "planipret_phone_calls", "INSERT", { new: { status: "inbound_ringing" } }); r.rerender(<S cb={latest} />); });
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
    expect(h.created).toHaveLength(1);
    r.unmount();
    expect(h.removeChannel).toHaveBeenCalledTimes(1);
  });
});
