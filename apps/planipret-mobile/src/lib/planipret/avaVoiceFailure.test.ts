import { describe, expect, it } from "vitest";
import { describeVoiceStartError } from "./avaVoiceFailure";

describe("diagnostic de démarrage AVA", () => {
  it("conserve un diagnostic utile sans URL, jeton ou en-tête d’autorisation", () => {
    const result = describeVoiceStartError({
      name: "TransportError",
      code: "failed",
      message: "Bearer super-secret https://voice.example.test/?token=abc&signature=def eyJhbGciOiJIUzI1NiJ9.payload.signature",
    });
    expect(result).toContain("TransportError");
    expect(result).toContain("failed");
    expect(result).not.toMatch(/super-secret|https|token=abc|signature=def|eyJ|bearer/i);
  });

  it("garde les erreurs microphone compréhensibles", () => {
    expect(describeVoiceStartError({ name: "NotAllowedError" })).toBe("microphone_denied");
    expect(describeVoiceStartError({ name: "NotFoundError" })).toBe("microphone_missing");
  });
});
