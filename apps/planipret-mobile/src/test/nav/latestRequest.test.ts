import { describe, it, expect, vi } from "vitest";
import { createLatestRequest, scopedKey } from "@/lib/planipret/latestRequest";

const deferred = <T,>() => { let resolve!: (v: T) => void; const p = new Promise<T>((r) => (resolve = r)); return { p, resolve }; };

describe("latest request wins", () => {
  it("A then B, responses inverted: only B published", async () => {
    const lr = createLatestRequest<string>(); const pub: string[] = [];
    const a = deferred<string>(), b = deferred<string>();
    const ra = lr.run(scopedKey("u1", "search", { q: "a" }), async (c) => { const v = await a.p; if (c.isCurrent()) pub.push(v); return v; });
    const rb = lr.run(scopedKey("u1", "search", { q: "b" }), async (c) => { const v = await b.p; if (c.isCurrent()) pub.push(v); return v; });
    b.resolve("B"); a.resolve("A");
    expect(await rb).toBe("B"); expect(await ra).toBeUndefined(); expect(pub).toEqual(["B"]);
  });
  it("identical key joins in-flight (double refresh / double loadMore = one wave)", async () => {
    const lr = createLatestRequest<number>(); const fn = vi.fn(async () => 1);
    const k = scopedKey("u1", "commissions", { page: 2, period: "2026" });
    const [x, y] = await Promise.all([lr.run(k, fn), lr.run(k, fn)]);
    expect(fn).toHaveBeenCalledTimes(1); expect(x).toBe(1); expect(y).toBe(1);
  });
  it("aborts previous signal on key change (route/filter/period/client)", async () => {
    const lr = createLatestRequest<void>(); let sig!: AbortSignal; const d = deferred<void>();
    lr.run("k1", async (c) => { sig = c.signal; await d.p; });
    lr.run("k2", async () => {});
    expect(sig.aborted).toBe(true); d.resolve();
  });
  it("dispose (unmount) prevents any publish", async () => {
    const lr = createLatestRequest<string>(); const d = deferred<string>(); const pub: string[] = [];
    const r = lr.run("k", async (c) => { const v = await d.p; if (c.isCurrent()) pub.push(v); return v; });
    lr.dispose(); d.resolve("late");
    expect(await r).toBeUndefined(); expect(pub).toEqual([]); expect(lr.activeKey).toBeNull();
    expect(await lr.run("k", async () => "x")).toBeUndefined();
  });
  it("stale error swallowed, current error propagates", async () => {
    const lr = createLatestRequest<void>(); const d = deferred<void>();
    const old = lr.run("a", async () => { await d.p; throw new Error("old"); });
    lr.run("b", async () => {}); d.resolve();
    await expect(old).resolves.toBeUndefined();
    await expect(lr.run("c", async () => { throw new Error("now"); })).rejects.toThrow("now");
  });
  it("keys are broker-scoped", () => {
    expect(scopedKey("u1", "crm", { client: "x" })).not.toBe(scopedKey("u2", "crm", { client: "x" }));
  });
});
