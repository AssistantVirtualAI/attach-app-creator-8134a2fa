import { describe, expect, it } from "vitest";
import { mergeSmsThreadMessages } from "@/lib/planipret/smsThreadMerge";

describe("mergeSmsThreadMessages", () => {
  it("keeps the whole internal conversation in time order, sent and received", () => {
    const own = [
      { id: "a", direction: "outbound", body: "Bonjour Jannie", created_at: "2026-10-26T22:12:01Z" },
      { id: "c", direction: "outbound", body: "Bonsoir voici le message", created_at: "2026-10-26T22:12:01.039Z" },
    ];
    const extra = [
      { id: "b", direction: "outbound", body: "Bonjour Marc!", created_at: "2026-10-26T21:59:18Z", user_id: "peer-profile" },
    ];
    const merged = mergeSmsThreadMessages(own, extra);
    expect(merged.map((m) => m.id)).toEqual(["b", "a", "c"]);
    expect(merged.some((m) => m.body === "Bonjour Marc!")).toBe(true);
  });

  it("drops the broker's own rows duplicated by the server read, by id", () => {
    const own = [{ id: "a", body: "x", created_at: "2026-10-26T22:00:00Z" }];
    const extra = [
      { id: "a", body: "x", created_at: "2026-10-26T22:00:00Z" },
      { id: "b", body: "y", created_at: "2026-10-26T22:05:00Z" },
    ];
    const merged = mergeSmsThreadMessages(own, extra);
    expect(merged).toHaveLength(2);
    expect(merged.filter((m) => m.id === "a")).toHaveLength(1);
  });

  it("tolerates rows without ids and empty inputs", () => {
    expect(mergeSmsThreadMessages([], [])).toEqual([]);
    expect(mergeSmsThreadMessages([{ body: "no id" }], null as any)).toEqual([]);
  });
});
