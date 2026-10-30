import { describe, it, expect } from "vitest";
import { groupCallSegments } from "@/lib/planipret/callSegments";

const seg = (id: string, parent: string, start: string, dur: number, reason: string, extra: any = {}) => ({
  id, started_at: start, duration_seconds: dur, status: reason,
  metadata: { netSapiens: { "call-parent-call-id": parent, "call-disconnect-reason-text": reason, ...extra } },
});

describe("groupCallSegments", () => {
  it("merges a moved call into one row with total duration and drops the MoveMyCall helper", () => {
    const out = groupCallSegments<any>([
      seg("a", "P1", "2026-10-30T10:00:00Z", 30, "Retrieved"),
      { id: "h", started_at: "2026-10-30T10:00:30Z", duration_seconds: 2, metadata: { netSapiens: { "call-parent-call-id": "", "call-orig-to-user": "MoveMyCall" } } },
      seg("b", "P1", "2026-10-30T10:00:31Z", 90, "Orig: Bye"),
      seg("c", "P2", "2026-10-30T11:00:00Z", 10, "Orig: Bye"),
    ]);
    expect(out).toHaveLength(2);
    const moved = out.find((c) => c.id === "a")!;
    expect(moved.duration_seconds).toBe(120);
    expect(moved.status).toBe("Orig: Bye");
  });
});
