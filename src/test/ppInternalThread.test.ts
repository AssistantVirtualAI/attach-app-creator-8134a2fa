import { describe, expect, it } from "vitest";
import { internalThreadPair, internalThreadOrFilter } from "../../supabase/functions/_shared/pp-internal-thread.ts";

describe("internalThreadPair", () => {
  it("accepts an internal extension peer against the JWT broker extension", () => {
    expect(internalThreadPair("1136", "1284")).toEqual({ own: "1136", peer: "1284" });
  });

  it("strips non-digits from both sides", () => {
    expect(internalThreadPair(" ext1136 ", "poste 1284")).toEqual({ own: "1136", peer: "1284" });
  });

  it("rejects external phone numbers as peer (no SMS exposure through the internal read)", () => {
    expect(internalThreadPair("1136", "15149685574")).toBeNull();
    expect(internalThreadPair("1136", "4389535011")).toBeNull();
  });

  it("rejects missing or one-digit peers", () => {
    expect(internalThreadPair("1136", "")).toBeNull();
    expect(internalThreadPair("1136", "1")).toBeNull();
    expect(internalThreadPair("", "1284")).toBeNull();
  });
});

describe("internalThreadOrFilter", () => {
  it("matches both directions of the extension pair only", () => {
    expect(internalThreadOrFilter("1136", "1284")).toBe(
      "and(from_number.eq.1136,to_number.eq.1284),and(from_number.eq.1284,to_number.eq.1136)",
    );
  });
});
