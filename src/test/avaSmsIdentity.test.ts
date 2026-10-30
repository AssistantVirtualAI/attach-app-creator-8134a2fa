import { describe, expect, it } from "vitest";
import { bookingIntent, fileStatusIntent, smsIdentityVerified } from "../../supabase/functions/_shared/ava-sms-policy";
const profile = { first_name: "Jean-François", last_name: "Côté", phones: { cell: "(514) 216-3359" } };
describe("AVA SMS customer identity for file updates", () => {
 it("passes only with first+last name typed by sender and matching texting number", () => {
  expect(smsIdentityVerified("Jean-François Côté", "Bonjour, ici Jean-François Côté", "+15142163359", profile)).toBe(true);
  expect(smsIdentityVerified("jean-francois cote", "c'est jean-francois cote", "15142163359", profile)).toBe(true);
 });
 it("fails when the number differs from the profile", () => {
  expect(smsIdentityVerified("Jean-François Côté", "Jean-François Côté", "+15145550000", profile)).toBe(false);
 });
 it("fails with first name only or a different name", () => {
  expect(smsIdentityVerified("Jean-François", "Jean-François", "+15142163359", profile)).toBe(false);
  expect(smsIdentityVerified("Marie Côté", "Marie Côté", "+15142163359", profile)).toBe(false);
 });
 it("fails when the name was never written by the sender", () => {
  expect(smsIdentityVerified("Jean-François Côté", "où est mon dossier?", "+15142163359", profile)).toBe(false);
 });
 it("recognises booking and file-status intents", () => {
  expect(bookingIntent("Je voudrais un rendez-vous demain 14h")).toBe(true);
  expect(fileStatusIntent("Où en est mon dossier?")).toBe(true);
  expect(bookingIntent("Merci beaucoup")).toBe(false);
 });
});
