import { describe, expect, it } from "vitest";
import { clientHistoryOwnerIds } from "../clientHistoryScope";
import { maestroClientProfileFromPayload } from "../clientProfile";
import { canViewLocalCallMedia } from "../recordingConsent";

describe("portal client history scope", () => {
  it("covers both durable broker identities without duplication", () => {
    expect(clientHistoryOwnerIds("auth-1", "profile-1")).toEqual(["profile-1", "auth-1"]);
    expect(clientHistoryOwnerIds("auth-1", "auth-1")).toEqual(["auth-1"]);
  });

  it("retains all verified Maestro phone numbers", () => {
    const profile = maestroClientProfileFromPayload({
      profile: {
        id: "511",
        first_name: "Jane",
        last_name: "Doe",
        telephones: [
          { telephone_type: "mobile", telephone_number: "5145550123" },
          { telephone_type: "work", telephone_number: "4385550456" },
        ],
      },
    });
    expect(profile?.phones).toEqual(["5145550123", "4385550456"]);
  });

  it("keeps retained local media available until an explicit deletion", () => {
    expect(canViewLocalCallMedia("pending")).toBe(true);
    expect(canViewLocalCallMedia("approved")).toBe(true);
    expect(canViewLocalCallMedia("declined")).toBe(false);
  });
});
