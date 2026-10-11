/**
 * Cycle de vie du canal Realtime de RegisterCommissions (production inchangée) :
 * une souscription au montage, un événement = un seul rafraîchissement,
 * removeChannel à l'unmount, aucun appel après unmount, aucun double fetch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";

const invokeMock = vi.fn();
const channels: { name: string; handlers: Array<() => void>; subscribed: number; removed: boolean }[] = [];
const makeChannel = (name: string) => {
  const entry = { name, handlers: [] as Array<() => void>, subscribed: 0, removed: false };
  channels.push(entry);
  const ch: any = {
    on: (_t: string, _f: unknown, cb: () => void) => { entry.handlers.push(cb); return ch; },
    subscribe: () => { entry.subscribed += 1; return ch; },
    __entry: entry,
  };
  return ch;
};

vi.mock("@/integrations/supabase/client", () => {
  const q: any = new Proxy(function () {}, {
    get: (_t, k) => (k === "then" ? (r: any) => r({ data: [], error: null }) : q),
    apply: () => q,
  });
  return {
    supabase: {
      functions: { invoke: (fn: string, opts: any) => invokeMock(fn, opts) },
      channel: (name: string) => makeChannel(name),
      removeChannel: (ch: any) => { if (ch?.__entry) ch.__entry.removed = true; return Promise.resolve("ok"); },
      from: () => q,
      rpc: () => Promise.resolve({ data: null, error: null }),
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: "u1" } } }),
        getSession: () => Promise.resolve({ data: { session: { access_token: "t" } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});

vi.mock("recharts", async () => {
  const React = await import("react");
  const Stub = ({ children }: any) => React.createElement("div", null, children);
  const Null = () => null;
  return {
    ResponsiveContainer: Stub, BarChart: Stub, ComposedChart: Stub, AreaChart: Stub, LineChart: Stub, PieChart: Stub,
    RadarChart: Stub, ScatterChart: Stub, Treemap: Null, Pie: Null, Radar: Null, Scatter: Null, PolarGrid: Null,
    PolarAngleAxis: Null, PolarRadiusAxis: Null, Cell: Null, Bar: Null, Line: Null, Area: Null, Legend: Null,
    XAxis: Null, YAxis: Null, ZAxis: Null, Tooltip: Null, CartesianGrid: Null, ReferenceLine: Null, LabelList: Null,
    Label: Null, Brush: Null, ReferenceArea: Null, Funnel: Null, FunnelChart: Stub, RadialBar: Null, RadialBarChart: Stub,
  };
});

import RegisterCommissions from "../RegisterCommissions";

const statsCalls = () => invokeMock.mock.calls.filter(([fn, o]) => fn === "pp-commission-stats" && !o?.body?.detailBrokerKey).length;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  channels.length = 0;
  invokeMock.mockReset();
  invokeMock.mockImplementation(() => Promise.resolve({ data: { brokers: [], brokerYearly: [], club: [] }, error: null }));
});

describe("RegisterCommissions — canal Realtime", () => {
  it("souscrit une fois, rafraîchit une fois par événement, se nettoie à l'unmount", async () => {
    const { unmount } = render(<RegisterCommissions lang="fr" scope="broker" />);
    await waitFor(() => expect(statsCalls()).toBe(1));
    const live = channels.filter((c) => c.name.startsWith("pp-commissions-live-"));
    expect(live).toHaveLength(1);
    expect(live[0].subscribed).toBe(1);

    await new Promise((r) => setTimeout(r, 50));
    expect(statsCalls()).toBe(1); // aucun double fetch au montage

    act(() => { live[0].handlers[0](); });
    await waitFor(() => expect(statsCalls()).toBe(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(statsCalls()).toBe(2); // un seul rafraîchissement par événement

    unmount();
    expect(live[0].removed).toBe(true);
    const before = invokeMock.mock.calls.length;
    act(() => { live[0].handlers.forEach((h) => h()); });
    await new Promise((r) => setTimeout(r, 50));
    expect(invokeMock.mock.calls.length).toBe(before);
  });
});
