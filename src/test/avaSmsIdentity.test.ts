import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { addressMatches, detectLanguage, holdingText, READ_ONLY_TOOLS, senderTier, signAvaSms, smsIdentityVerified, AVA_SMS_SIGNATURE } from "../../supabase/functions/_shared/ava-sms-policy";
const profile = { first_name: "Jean-François", last_name: "Côté", phones: { cell: "(514) 555-1212" }, address: { street: "1234 rue Sherbrooke Est", city: "Montréal" } };
const words = "Bonjour, ici Jean-François Côté, j'habite au 1234 rue Sherbrooke Est";
describe("AVA SMS trust tiers and customer verification", () => {
 it("trusts the owner's cell 514-216-3359 and internal lines, not others", () => {
  expect(senderTier("+15142163359", false)).toBe("owner");
  expect(senderTier("1142", true)).toBe("internal");
  expect(senderTier("+15145551212", false)).toBe("external");
 });
 it("verifies customer with name + address + matching phone", () => {
  expect(smsIdentityVerified("Jean-François Côté", "1234 rue Sherbrooke Est", words, "+15145551212", profile)).toBe(true);
 });
 it("refuses wrong address, wrong phone, missing last name or untyped details", () => {
  expect(smsIdentityVerified("Jean-François Côté", "99 rue Sherbrooke", words + " 99", "+15145551212", profile)).toBe(false);
  expect(smsIdentityVerified("Jean-François Côté", "1234 rue Sherbrooke Est", words, "+15145550000", profile)).toBe(false);
  expect(smsIdentityVerified("Jean-François", "1234 rue Sherbrooke Est", words, "+15145551212", profile)).toBe(false);
  expect(smsIdentityVerified("Jean-François Côté", "1234 rue Sherbrooke Est", "où est mon dossier?", "+15145551212", profile)).toBe(false);
  expect(addressMatches("1234 rue Ontario", profile)).toBe(false);
 });
 it("exposes only read tools on SMS", () => {
  for (const t of READ_ONLY_TOOLS) expect(/create|update|delete|complete|reschedule|send|submit/.test(t)).toBe(false);
 });
 it("does not reserve appointments or call Microsoft 365 from the SMS route", () => {
  const route = readFileSync("supabase/functions/pp-ava-sms/index.ts", "utf8");
  expect(route).not.toContain("ava_sms_book");
  expect(route).not.toContain('invoke("ms365-actions"');
  expect(route).not.toContain('kind==="appointment"');
 });
 it("replies in the sender's language with the holding text", () => {
  expect(detectLanguage("Hi, where is my mortgage file?")).toBe("en");
  expect(detectLanguage("Bonjour, où est mon dossier?")).toBe("fr");
  expect(holdingText("fr")).toContain("assistante de Marc");
  expect(holdingText("en")).toContain("Marc's assistant");
  expect(signAvaSms(signAvaSms(holdingText("en"))).split(AVA_SMS_SIGNATURE).length).toBe(2);
  expect(holdingText("en")).not.toContain("appointment booked");
 });
});
