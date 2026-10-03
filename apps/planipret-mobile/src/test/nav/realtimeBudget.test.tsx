import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({
  created: [] as string[], removeChannel: vi.fn(), cbs: [] as Array<(p: any) => void>,
  userDeferred: null as null | { resolve: (v: any) => void },
}));
const chain: any = new Proxy(function () {}, {
  get: (_t, k) => (k === "then" ? (r: any) => r({ data: [], error: null }) : chain),
  apply: () => chain,
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: (name: string) => { h.created.push(name); const ch: any = { on: (_e: string, _f: any, cb: any) => { h.cbs.push(cb); return ch; }, subscribe: () => ch }; return ch; },
    removeChannel: h.removeChannel,
    from: () => chain, rpc: () => chain,
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
    auth: { getUser: () => new Promise((resolve) => { h.userDeferred = { resolve }; }), getSession: vi.fn(async () => ({ data: { session: null } })) },
    storage: { from: () => chain },
  },
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import MAvaNotifications from "@/pages/planipret/mobile/MAvaNotifications";
import RecordingsList, { recordingsRealtimeStats } from "@/components/planipret/mobile/recordings/RecordingsList";

beforeEach(() => { h.created.length = 0; h.cbs.length = 0; h.removeChannel.mockClear(); });

describe("AVA notifications realtime", () => {
  it("unmount before auth resolves = no channel survives", async () => {
    const r = render(<MAvaNotifications />);
    r.unmount();
    await act(async () => { h.userDeferred!.resolve({ data: { user: { id: "u1" } } }); });
    expect(h.created.filter((n) => n.startsWith("ava-notif"))).toHaveLength(0);
  });
});

describe("recordings realtime budget", () => {
  it("N cards = one list channel; zero left after unmount; update routed once", async () => {
    recordingsRealtimeStats.created = 0; recordingsRealtimeStats.removed = 0;
    const calls = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, transcript: "t", created_at: new Date().toISOString() })) as any[];
    const onUpdated = vi.fn();
    const r = render(<RecordingsList calls={calls} loading={false} userId="u1" onUpdated={onUpdated} />);
    expect(h.created.filter((n) => n.startsWith("pp-mobile-call"))).toHaveLength(1);
    act(() => { for (const cb of h.cbs) cb({ new: { id: "c3", ai_summary: "s" } }); });
    expect(onUpdated.mock.calls.filter(([c]) => c.id === "c3")).toHaveLength(1);
    r.unmount();
    expect(recordingsRealtimeStats.created - recordingsRealtimeStats.removed).toBe(0);
  });
});
