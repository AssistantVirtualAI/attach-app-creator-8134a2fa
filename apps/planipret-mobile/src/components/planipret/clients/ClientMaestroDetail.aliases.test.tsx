/**
 * Client history alias resolution: calls and texts must be fetched with both
 * the auth user id and the Planiprêt profile id returned by planipret_broker_ids.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  calls: vi.fn(async (_ids: string[]) => [] as any[]),
  msgs: vi.fn(async (_ids: string[]) => [] as any[]),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: h.rpc,
    channel: () => { const c: any = { on: () => c, subscribe: () => c, unsubscribe: () => {} }; return c; },
    removeChannel: vi.fn(),
    auth: { getUser: async () => ({ data: { user: null } }), getSession: async () => ({ data: { session: null } }) },
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
    from: () => {
      const q: any = new Proxy({}, { get: (_t, p) => (p === "then" ? (r: any) => r({ data: [], error: null }) : () => q) });
      return q;
    },
  },
}));
vi.mock("@/lib/planipret/clientMaestro", async () => {
  const actual = await vi.importActual<any>("@/lib/planipret/clientMaestro");
  return {
    ...actual,
    fetchClientDeals: vi.fn(async () => []),
    fetchClientDeposits: vi.fn(async () => []),
    fetchClientContacts: vi.fn(async () => []),
    fetchClientCalls: h.calls,
    fetchClientMessages: h.msgs,
  };
});
vi.mock("@/components/planipret/mobile/call/CallRecordingPlayer", () => ({ CallRecordingPlayer: () => null }));

import ClientMaestroDetail from "./ClientMaestroDetail";

const AUTH = "auth-user-1";
const PROFILE = "profile-9";
const view = () => <ClientMaestroDetail clientKey="jeanne%20maestro" tasks={[]} userIds={[AUTH, AUTH]} lang="fr" />;

describe("ClientMaestroDetail — broker id aliases", () => {
  beforeEach(() => { h.rpc.mockReset(); h.calls.mockClear(); h.msgs.mockClear(); });

  it("passes both deduplicated ids to calls and messages", async () => {
    h.rpc.mockResolvedValue({ data: [PROFILE, AUTH, { planipret_broker_ids: PROFILE }], error: null });
    render(view());
    const want = [AUTH, PROFILE].sort();
    await waitFor(() => {
      expect(h.calls.mock.calls.some(([ids]) => JSON.stringify(ids) === JSON.stringify(want))).toBe(true);
      expect(h.msgs.mock.calls.some(([ids]) => JSON.stringify(ids) === JSON.stringify(want))).toBe(true);
    });
    expect(h.rpc).toHaveBeenCalledWith("planipret_broker_ids", { _uid: AUTH });
  });

  it("falls back to the auth id when the RPC fails", async () => {
    h.rpc.mockRejectedValue(new Error("rpc down"));
    render(view());
    await waitFor(() => {
      expect(h.calls.mock.calls.some(([ids]) => JSON.stringify(ids) === JSON.stringify([AUTH]))).toBe(true);
      expect(h.msgs.mock.calls.some(([ids]) => JSON.stringify(ids) === JSON.stringify([AUTH]))).toBe(true);
    });
  });

  it("does not update state after unmount", async () => {
    let resolve!: (v: any) => void;
    h.rpc.mockReturnValue(new Promise((r) => { resolve = r; }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(view());
    unmount();
    await act(async () => { resolve({ data: [PROFILE], error: null }); await Promise.resolve(); });
    expect(h.calls.mock.calls.some(([ids]) => (ids as string[]).includes(PROFILE))).toBe(false);
    expect(err.mock.calls.some((c) => String(c[0]).includes("unmounted"))).toBe(false);
    err.mockRestore();
  });
});
