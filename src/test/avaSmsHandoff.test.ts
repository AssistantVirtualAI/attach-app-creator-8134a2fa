import { describe, expect, it } from "vitest";
import { handoffCommand, handoffPaused, handoffPushAccepted, handoffSummary, providerHumanOutbound } from "../../supabase/functions/_shared/ava-sms-handoff";
import { createHandoffLifecycle } from "../lib/planipret/avaHandoffLifecycle";
import { MARC_SMS_USER_ID } from "../../supabase/functions/_shared/ava-sms-policy";
describe("SMS handoff rules",()=>{
 it("HTTP acceptance without a push provider acceptance is not a successful handoff alert",()=>{
  expect(handoffPushAccepted({delivered:0})).toBe(false);
  expect(handoffPushAccepted({})).toBe(false);
  expect(handoffPushAccepted({delivered:1,blocked_by_preference:true})).toBe(false);
  expect(handoffPushAccepted({delivered:1})).toBe(true);
 });
 it("fails closed when handoff storage is unavailable",async()=>{
  await expect(handoffPaused({rpc:async()=>({error:{message:"missing"}})},"+15145550101")).rejects.toThrow("handoff_unavailable");
 });
 it("only uses Marc's persisted owner for commands",async()=>{
  let owner="";await handoffCommand({rpc:async(_:string,args:any)=>{owner=args.p_user;return {data:{online:true}};}},"presence",{active:true});
  expect(owner).toBe(MARC_SMS_USER_ID);
 });
 it("foreground suppresses all peers",async()=>{
  const admin={rpc:async()=>({data:{paused:true}})};
  expect(await handoffPaused(admin,"+15145550101")).toBe(true);
  expect(await handoffPaused(admin,"+15145550102")).toBe(true);
 });
 it("serializes close after open and coalesces duplicate events without polling",async()=>{
  const events:boolean[]=[];const send=createHandoffLifecycle(async active=>{events.push(active);});
  void send(true);void send(true);await send(false);expect(events).toEqual([true,false]);
 });
 it("recognizes exact broker outbound, excludes AVA and foreign authors",()=>{
  const row={id:"provider-id",direction:"term","from-user-id":"1136@planipret.ca","terminating-user-id":"+15145550101",timestamp:"2026-10-30 06:00:00",text:"Bonjour"};
  expect(providerHumanOutbound(row,new Set(),"2026-10-30T00:00:00Z")?.peer).toBe("+15145550101");
  expect(providerHumanOutbound(row,new Set(["Bonjour"]),"2026-10-30T00:00:00Z")).toBeNull();
  expect(providerHumanOutbound({...row,"from-user-id":"1117@planipret.ca"},new Set(),"2026-10-30T00:00:00Z")).toBeNull();
  expect(providerHumanOutbound(row,new Set(),"2026-10-30T00:00:00Z",new Set(["provider-id"]))).toBeNull();
  expect(providerHumanOutbound({...row,direction:"unknown"},new Set(),"2026-10-30T00:00:00Z")).toBeNull();
 });
 it("allows an explicit lifecycle retry after a failed event",async()=>{
  let attempts=0;const event=createHandoffLifecycle(async()=>{attempts++;if(attempts===1)throw new Error("offline");});
  await expect(event(false)).rejects.toThrow("offline");await event(false);expect(attempts).toBe(2);
 });
 it("summary includes actual conversation evidence without inventing identity",()=>{
  const result=handoffSummary([{role:"user",text:"Un rendez-vous jeudi"}],"Je vérifie le créneau.");
  expect(result).toContain("Un rendez-vous jeudi");expect(result).toContain("Je vérifie le créneau.");expect(result).toContain("exhaustivité non confirmée");
  expect(result).not.toContain("Mohamad");
 });
});