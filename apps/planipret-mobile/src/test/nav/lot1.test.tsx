import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import React from "react";

const channels: any[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: () => { const ch: any = { on: () => ch, subscribe: () => ch }; channels.push(ch); return ch; },
    removeChannel: vi.fn(),
    functions: { invoke: vi.fn(() => Promise.resolve({})) },
  },
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn() }) }));

import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useRealtimeManager, realtimeManagerStats } from "@/hooks/useRealtimeManager";
import { sanitizeMs365ReturnTo, rememberMs365ReturnTo, consumeMs365ReturnTo } from "@/lib/planipret/ms365ReturnTo";

const touch = (el: Element, type: string, ys: number[]) => {
  const e: any = new Event(type, { bubbles: true });
  e.touches = ys.map((clientY) => ({ clientY }));
  el.dispatchEvent(e);
};

function P2R({ onRefresh, can = () => true, child = false }: any) {
  const { ref } = usePullToRefresh(onRefresh, 70, can);
  return <div ref={ref} data-testid="owner">{child && <div data-testid="inner" style={{ overflowY: "auto" }} />}</div>;
}

describe("pull-to-refresh", () => {
  it("fires once without intermediate React flush", async () => {
    const fn = vi.fn();
    const { getByTestId } = render(<P2R onRefresh={fn} />);
    const el = getByTestId("owner");
    touch(el, "touchstart", [0]); touch(el, "touchmove", [40]); touch(el, "touchmove", [90]);
    await act(async () => { touch(el, "touchend", []); });
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("touchcancel clears; multi-touch ignored; no registered refresh = nothing", async () => {
    const fn = vi.fn();
    const { getByTestId, unmount } = render(<P2R onRefresh={fn} />);
    const el = getByTestId("owner");
    touch(el, "touchstart", [0]); touch(el, "touchmove", [100]); touch(el, "touchcancel", []);
    await act(async () => { touch(el, "touchend", []); });
    touch(el, "touchstart", [0, 10]); touch(el, "touchmove", [100, 110]);
    await act(async () => { touch(el, "touchend", []); });
    unmount();
    const r2 = render(<P2R onRefresh={fn} can={() => false} />);
    const el2 = r2.getByTestId("owner");
    touch(el2, "touchstart", [0]); touch(el2, "touchmove", [100]);
    await act(async () => { touch(el2, "touchend", []); });
    expect(fn).not.toHaveBeenCalled();
  });
  it("gesture in a non-owner scrollable child = zero refresh", async () => {
    const fn = vi.fn();
    const { getByTestId } = render(<P2R onRefresh={fn} child />);
    const inner = getByTestId("inner");
    Object.defineProperty(inner, "scrollHeight", { value: 500 });
    Object.defineProperty(inner, "clientHeight", { value: 100 });
    touch(inner, "touchstart", [0]); touch(inner, "touchmove", [100]);
    await act(async () => { touch(inner, "touchend", []); });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("realtime manager", () => {
  beforeEach(() => { realtimeManagerStats.created = 0; realtimeManagerStats.removed = 0; });
  it("20 shell re-renders = one subscription; zero left after unmount", () => {
    function Shell({ n }: { n: number }) { useRealtimeManager("u1", { onInboundRinging: () => n, onAiInsight: () => n }); return null; }
    const r = render(<Shell n={0} />);
    for (let i = 1; i <= 20; i++) r.rerender(<Shell n={i} />);
    expect(realtimeManagerStats.created).toBe(1);
    r.unmount();
    expect(realtimeManagerStats.created - realtimeManagerStats.removed).toBe(0);
  });
});

describe("ms365 return destination", () => {
  it("accepts only whitelisted internal paths", () => {
    expect(sanitizeMs365ReturnTo("/mplanipret/more")).toBe("/mplanipret/more");
    expect(sanitizeMs365ReturnTo("/mplanipret/ms365-diagnostics")).toBe("/mplanipret/ms365-diagnostics");
    for (const bad of ["https://evil.example/mplanipret/more", "//evil.example", "/mplanipret/../admin", "/planipret/admin", "javascript:alert(1)", "/mplanipret/more?x=1", "", null, 5]) expect(sanitizeMs365ReturnTo(bad)).toBeNull();
  });
  it("remember/consume from More and Diagnostics; fallback on malformed, stale or missing", () => {
    rememberMs365ReturnTo("/mplanipret/more"); expect(consumeMs365ReturnTo()).toBe("/mplanipret/more");
    expect(consumeMs365ReturnTo()).toBe("/mplanipret/home");
    rememberMs365ReturnTo("/mplanipret/ms365-diagnostics"); expect(consumeMs365ReturnTo()).toBe("/mplanipret/ms365-diagnostics");
    rememberMs365ReturnTo("/mplanipret/more", Date.now() - 31 * 60_000); expect(consumeMs365ReturnTo()).toBe("/mplanipret/home");
    localStorage.setItem("pp_ms365_return_to_v1", "{bad"); expect(consumeMs365ReturnTo()).toBe("/mplanipret/home");
    localStorage.setItem("pp_ms365_return_to_v1", JSON.stringify({ path: "https://evil.example", at: Date.now() })); expect(consumeMs365ReturnTo()).toBe("/mplanipret/home");
    rememberMs365ReturnTo("/mplanipret/calls"); expect(consumeMs365ReturnTo()).toBe("/mplanipret/home");
  });
});
