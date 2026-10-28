import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ broadcast: null as null | (() => void), invalidate: vi.fn(), remove: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  channel: () => ({ on: (_type: string, _filter: unknown, fn: () => void) => { mocks.broadcast = fn; return { subscribe: () => ({}) }; } }),
  removeChannel: mocks.remove,
} }));
vi.mock("@/lib/planipret/commissionClientCache", () => ({ invalidateCommissionCache: mocks.invalidate }));
import { useCommissionLive } from "./useCommissionLive";

describe("commission refresh without polling", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  it("does not refresh every minute or when switching tabs without new data", () => {
    const update = vi.fn(); renderHook(() => useCommissionLive(update));
    act(() => { vi.advanceTimersByTime(180000); document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus")); });
    expect(update).not.toHaveBeenCalled();
  });
  it("immediately refreshes all mounted views when a saved snapshot changes", () => {
    const a = vi.fn(), b = vi.fn(); renderHook(() => useCommissionLive(a)); renderHook(() => useCommissionLive(b));
    act(() => { mocks.broadcast?.(); });
    expect(a).toHaveBeenCalledTimes(1); expect(b).toHaveBeenCalledTimes(1); expect(mocks.invalidate).toHaveBeenCalledTimes(1);
  });
  it("retains an update received while hidden and consumes it once on return", () => {
    const update = vi.fn(); renderHook(() => useCommissionLive(update));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    act(() => { mocks.broadcast?.(); mocks.broadcast?.(); }); expect(update).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); document.dispatchEvent(new Event("visibilitychange")); });
    expect(update).toHaveBeenCalledTimes(1);
  });
});