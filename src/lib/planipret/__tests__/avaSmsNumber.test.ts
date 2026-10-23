import { describe, it, expect } from "vitest";
import { normalizeAvaSmsRecipient } from "../avaSmsRecipient";
import { formatPhoneDisplay } from "../ovPeer";

describe("AVA SMS recipient number", () => {
  it("reads a formatted number from the payload", () => {
    expect(normalizeAvaSmsRecipient({ numero: "514 880-1737", message: "Bonjour" }).number).toBe("514 880-1737");
  });
  it("reads +1 number", () => {
    expect(normalizeAvaSmsRecipient({ to: "+15148801737", message: "x" }).number).toBe("+15148801737");
  });
  it("falls back to the number typed by the user", () => {
    expect(normalizeAvaSmsRecipient({ message: "x" }, "texte au 514-880-1737 svp").number).toBe("514-880-1737");
  });
  it("keeps a name only as contact name, never a guessed number", () => {
    const r = normalizeAvaSmsRecipient({ to: "Megan Lussier", message: "x" }, "écris à Megan");
    expect(r.number).toBe("");
    expect(r.contactName).toBe("Megan Lussier");
  });
  it("returns nothing when nothing is given", () => {
    const r = normalizeAvaSmsRecipient({ message: "x" }, "bonjour");
    expect(r.number).toBe("");
    expect(r.contactName).toBe("");
  });
  it("formats display numbers", () => {
    expect(formatPhoneDisplay("15148801737")).toBe("(514) 880-1737");
  });
});
