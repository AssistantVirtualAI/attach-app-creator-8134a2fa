import { describe, expect, it } from "vitest";
import { normalizeAvaEmailPayload } from "../../supabase/functions/ava-tool-executor/emailPayload";

describe("AVA email recipient contract for every broker", () => {
  it("maps the voice/chat registry to_email to Microsoft's to field", () => {
    const input = { to_email: " recipient@example.test ", subject: "Subject", body: "Message", confirmed: true, idempotency_key: "same-send" };
    expect(normalizeAvaEmailPayload(input)).toEqual({ ...input, to: "recipient@example.test" });
    expect(input).not.toHaveProperty("to");
  });

  it("preserves an explicitly selected recipient rather than replacing it", () => {
    expect(normalizeAvaEmailPayload({ to: ["selected@example.test"], to_email: "other@example.test" }).to).toEqual(["selected@example.test"]);
  });

  it("allows the registry recipient when to is blank or an empty array", () => {
    for (const to of ["", "  ", []]) {
      expect(normalizeAvaEmailPayload({ to, to_email: "recipient@example.test" }).to).toBe("recipient@example.test");
    }
  });

  it("does not invent recipients or grant confirmation", () => {
    const payload = normalizeAvaEmailPayload({ contact_name: "Contact", confirmed: false });
    expect(payload).toEqual({ contact_name: "Contact", confirmed: false });
  });
});