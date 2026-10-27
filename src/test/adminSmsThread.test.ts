import { describe, expect, it } from "vitest";
import { matchesSmsThreadPair } from "./adminSmsThread";

// Scenario from the reported bug: the broker texts a client from the DID
// +14388427217, the client's replies are mirrored by the webhook onto the
// broker's extension 113, and the admin conversation showed only sent texts.
const pairing = { peerKey: "5149685574", lineKey: "4388427217", brokerExt: "113" };

describe("matchesSmsThreadPair", () => {
  it("keeps outbound rows sent from the broker DID", () => {
    expect(matchesSmsThreadPair("+14388427217", "+15149685574", pairing)).toBe(true);
  });

  it("keeps webhook replies mirrored onto the broker extension", () => {
    expect(matchesSmsThreadPair("15149685574", "113", pairing)).toBe(true);
  });

  it("keeps replies mirrored with the full DID as the receiving line", () => {
    expect(matchesSmsThreadPair("15149685574", "14388427217", pairing)).toBe(true);
  });

  it("drops rows from another broker's line to the same client", () => {
    expect(matchesSmsThreadPair("+14505405253", "+15149685574", pairing)).toBe(false);
  });

  it("drops rows where the client number is on neither side", () => {
    expect(matchesSmsThreadPair("15149685574", "1284", pairing)).toBe(false);
  });

  it("falls back to any internal extension when the broker extension is unknown", () => {
    const unknownExt = { peerKey: "5149685574", lineKey: "4388427217" };
    expect(matchesSmsThreadPair("15149685574", "1136", unknownExt)).toBe(true);
  });

  it("keeps internal extension-to-extension threads scoped to the clicked line", () => {
    const internal = { peerKey: "1284", lineKey: "1136", brokerExt: "1136" };
    expect(matchesSmsThreadPair("1136", "1284", internal)).toBe(true);
    expect(matchesSmsThreadPair("1284", "1136", internal)).toBe(true);
    expect(matchesSmsThreadPair("111", "1284", internal)).toBe(false);
  });
});
