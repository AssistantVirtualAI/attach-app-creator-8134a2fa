import { describe, expect, it } from "vitest";
import { eligibleInbound, explicitBookingRequest, hasCalendarConflict, MARC_SMS_PROFILE_ID, MARC_SMS_USER_ID, pilotOwner, safeThread, smsPeer } from "../../supabase/functions/_shared/ava-sms-policy";
const marc = { id: MARC_SMS_PROFILE_ID, user_id: MARC_SMS_USER_ID, extension: "1136", ns_domain: "planipret.ca" };
describe("Marc-only SMS policy", () => {
 it("requires exact Marc owner and 1136", () => {
  expect(pilotOwner(marc)).toBe(true);
  for (const extension of ["113", "1117", "1142", "1136M", "1136x"]) expect(pilotOwner({ ...marc, extension })).toBe(false);
  expect(pilotOwner({ ...marc, user_id: "another-owner" })).toBe(false);
 });
 it("never processes old or outgoing messages", () => {
  const row={user_id:marc.id,direction:"inbound",created_at:"2026-10-30T05:00:00Z",from_number:"5145551234",to_number:"5145555678"};
  const config={enabled:true,activated_at:"2026-10-30T04:00:00Z"};
  expect(eligibleInbound(row,config,marc)).toBe(true);
  expect(eligibleInbound({...row,direction:"outbound"},config,marc)).toBe(false);
  expect(eligibleInbound({...row,created_at:"2026-10-29T05:00:00Z"},config,marc)).toBe(false);
  expect(eligibleInbound(row,{...config,enabled:false},marc)).toBe(false);
 });
 it("keeps history inside one owner and one peer", () => {
  const rows=[{user_id:marc.id,direction:"inbound",from_number:"5145551234"},{user_id:"other",direction:"inbound",from_number:"5145551234"},{user_id:marc.id,direction:"outbound",to_number:"5145559999"}];
  expect(safeThread(rows,marc.id,"+15145551234")).toEqual([rows[0]]);
 });
 it("blocks overlaps but permits adjacent appointments", () => {
  const events=[{start:"2026-11-02T14:00:00Z",end:"2026-11-02T15:00:00Z"}];
  expect(hasCalendarConflict("2026-11-02T14:30:00Z","2026-11-02T15:30:00Z",events)).toBe(true);
  expect(hasCalendarConflict("2026-11-02T15:00:00Z","2026-11-02T15:30:00Z",events)).toBe(false);
 });
 it("normalizes peers without granting authentication",()=>{
  expect(smsPeer("1136")).toBe("1136"); expect(smsPeer("Jannie 1136")).toBeNull();
 });
 it("never books an ambiguous or merely informational request",()=>{
  expect(explicitBookingRequest("Réserve un rendez-vous le 2026-11-02 à 14h00 pour 30 minutes")).toBe(true);
  expect(explicitBookingRequest("Je suis libre demain")).toBe(false);
  expect(explicitBookingRequest("Quels rendez-vous as-tu le 2026-11-02 à 14h00 pour 30 minutes?")).toBe(false);
 });
});