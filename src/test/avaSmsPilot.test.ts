import { describe, expect, it } from "vitest";
import { eligibleInbound, MARC_SMS_PROFILE_ID, MARC_SMS_USER_ID, pilotOwner, safeThread, smsPeer } from "../../supabase/functions/_shared/ava-sms-policy";
import { marcSessionMessagesPath } from "../../supabase/functions/_shared/ava-sms-watch";
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
 it("normalizes peers without granting authentication",()=>{
  expect(smsPeer("1136")).toBe("1136"); expect(smsPeer("Jannie 1136")).toBeNull();
 });
 it("requests up to one hundred messages from only the current provider thread",()=>{
  expect(marcSessionMessagesPath("thread a/b")).toContain("thread%20a%2Fb/messages?limit=100");
 });
});import { AVA_SMS_SIGNATURE, pilotInboundRow, providerHistory, sessionNeedsRead, signAvaSms } from "../../supabase/functions/_shared/ava-sms-policy";
const ns=(o:any)=>({id:"m-1",timestamp:"2026-10-30 04:53:00",type:"sms",direction:"orig",dialed:14389535011,text:"Bonsoir Marc",
 "from-number":15142163359,"from-user-id":"","terminating-user-id":"1136@planipret.ca","messagesession-id":"s1","deleted-datetime":"",...o});
describe("AVA SMS watcher and signature", () => {
 it("always signs as AVA exactly once", () => {
  expect(signAvaSms("Bonjour!")).toBe(`Bonjour!\n${AVA_SMS_SIGNATURE}`);
  expect(signAvaSms(signAvaSms("Bonjour!"))).toBe(`Bonjour!\n${AVA_SMS_SIGNATURE}`);
  expect(AVA_SMS_SIGNATURE).toBe("— AVA, assistante de Marc Maglieri");
 });
 it("imports only inbound texts addressed to Marc's line", () => {
  const row=pilotInboundRow(ns({}),MARC_SMS_PROFILE_ID,"org");
  expect(row).toMatchObject({ns_message_id:"m-1",direction:"inbound",from_number:"15142163359",sent_at:"2026-10-30T04:53:00.000Z",thread_id:"s1"});
  expect(pilotInboundRow(ns({direction:"term"}),MARC_SMS_PROFILE_ID,"org")).toBeNull();
  expect(pilotInboundRow(ns({"terminating-user-id":"1117@planipret.ca"}),MARC_SMS_PROFILE_ID,"org")).toBeNull();
  expect(pilotInboundRow(ns({"from-user-id":"1136@planipret.ca"}),MARC_SMS_PROFILE_ID,"org")).toBeNull();
  expect(pilotInboundRow(ns({"deleted-datetime":"2026-10-30"}),MARC_SMS_PROFILE_ID,"org")).toBeNull();
 });
 it("identifies internal extensions as internal peers", () => {
  expect(pilotInboundRow(ns({"from-user-id":"1142@planipret.ca",type:"chat"}),MARC_SMS_PROFILE_ID,"org")?.from_number).toBe("1142");
 });
 it("reads a session only when someone other than Marc spoke last after activation", () => {
  const s={"messagesession-id":"s1","messagesession-last-datetime":"2026-10-30T04:53:00+00:00","messagesession-last-sender":15142163359};
  const now=Date.parse("2026-10-30T05:30:00Z");
  expect(sessionNeedsRead(s,"2026-10-30T04:46:16Z",now)).toBe(true);
  expect(sessionNeedsRead({...s,"messagesession-last-sender":"1136@planipret.ca"},"2026-10-30T04:46:16Z",now)).toBe(false);
  expect(sessionNeedsRead(s,"2026-10-30T05:00:00Z",now)).toBe(false);
 });
 it("builds the full conversation for one peer only, oldest first", () => {
  const msgs=[ns({id:"a",timestamp:"2026-10-30 04:53:00",text:"Bonsoir"}),
   ns({id:"b",timestamp:"2026-10-29 23:52:51",direction:"term","terminating-number":15142163359,"terminating-user-id":null,text:"Salut"}),
   ns({id:"c",timestamp:"2026-10-30 01:00:00","from-number":15145550000,text:"Autre personne"})];
  expect(providerHistory(msgs,"+15142163359")).toEqual([{role:"assistant",text:"Salut"},{role:"user",text:"Bonsoir"}]);
 });
});
