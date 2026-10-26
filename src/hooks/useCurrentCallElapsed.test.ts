import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCurrentCallElapsed } from "./useCurrentCallElapsed";

afterEach(() => vi.useRealTimers());

describe("current call duration", () => {
  it.each(["ended", "idle"])("resets to zero on %s even with a retained old start", (state) => {
    vi.useFakeTimers();
    vi.setSystemTime(6_000_000);
    const { result, rerender } = renderHook(({ state, start }) => useCurrentCallElapsed(state, start), {
      initialProps: { state: "active", start: 509_000 },
    });
    expect(result.current).toBe(5491); // 91:31 from the reported screen
    rerender({ state, start: 509_000 });
    expect(result.current).toBe(0);
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts the next call at zero without inheriting the previous duration", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const { result, rerender } = renderHook(({ state, start }) => useCurrentCallElapsed(state, start), {
      initialProps: { state: "active", start: 10_000 },
    });
    expect(result.current).toBe(90);
    rerender({ state: "ended", start: 10_000 });
    rerender({ state: "ringing-out", start: 10_000 });
    expect(result.current).toBe(0);
    rerender({ state: "active", start: 100_000 });
    expect(result.current).toBe(0);
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toBe(2);
  });

  it("keeps elapsed time while held and returns zero without a start time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const { result, rerender } = renderHook(({ state, start }: { state: string; start: number | null }) => useCurrentCallElapsed(state, start), {
      initialProps: { state: "held", start: 90_000 as number | null },
    });
    expect(result.current).toBe(10);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(11);
    rerender({ state: "active", start: null });
    expect(result.current).toBe(0);
  });
});