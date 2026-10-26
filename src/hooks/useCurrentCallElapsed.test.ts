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

  it("keeps the same clock through hold and a missing timestamp update", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const { result, rerender } = renderHook(({ state, start }: { state: string; start: number | null }) => useCurrentCallElapsed(state, start), {
      initialProps: { state: "held", start: 90_000 as number | null },
    });
    expect(result.current).toBe(10);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(11);
    rerender({ state: "active", start: null });
    expect(result.current).toBe(11);
  });

  it("excludes ringing on two consecutive dialogs even with an identical stale timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const { result, rerender } = renderHook(({ state, id }) => useCurrentCallElapsed(state, 10_000, id), {
      initialProps: { state: "ringing-in", id: "first-dialog" },
    });
    act(() => vi.advanceTimersByTime(30_000));
    expect(result.current).toBe(0);
    rerender({ state: "active", id: "first-dialog" });
    expect(result.current).toBe(0);
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current).toBe(5);
    rerender({ state: "ended", id: "first-dialog" });
    expect(result.current).toBe(0);
    rerender({ state: "ringing-out", id: "second-dialog" });
    act(() => vi.advanceTimersByTime(20_000));
    expect(result.current).toBe(0);
    rerender({ state: "active", id: "second-dialog" });
    expect(result.current).toBe(0);
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toBe(2);
  });

  it("resets a new dialog even if an ended update was skipped", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const { result, rerender } = renderHook(({ id }) => useCurrentCallElapsed("active", 10_000, id), {
      initialProps: { id: "first-dialog" },
    });
    expect(result.current).toBe(90);
    rerender({ id: "second-dialog" });
    expect(result.current).toBe(0);
  });
});