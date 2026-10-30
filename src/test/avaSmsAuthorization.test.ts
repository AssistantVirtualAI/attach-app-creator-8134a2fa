import { describe, expect, it } from "vitest";
import { authorizeSmsJob } from "../../supabase/functions/_shared/ava-sms-authorization";
import { MARC_SMS_PROFILE_ID, MARC_SMS_USER_ID } from "../../supabase/functions/_shared/ava-sms-policy";
function store(){
 const job:any={id:"job",user_id:MARC_SMS_USER_ID,profile_id:MARC_SMS_PROFILE_ID,status:"ready",peer:"+15145551234",reply:"Bonjour",reply_claimed_at:null};
 const profile:any={id:MARC_SMS_PROFILE_ID,user_id:MARC_SMS_USER_ID,extension:"1136",ns_domain:"planipret.ca",ava_chat_enabled:true,ai_consent_at:"2026-10-30",ai_consent_revoked_at:null};
 const config={user_id:MARC_SMS_USER_ID,enabled:true,profile_id:MARC_SMS_PROFILE_ID};
 const admin={rpc:async()=>({data:{paused:false}}),from:(table:string)=>{
  const row=table.endsWith("pilot")?config:table==="planipret_profiles"?profile:job;
  let patch:any=null;const filters:Array<[string,unknown]>=[];
  const q:any={select:()=>q,eq:(key:string,value:unknown)=>{filters.push([key,value]);return q;},is:(key:string,value:unknown)=>{filters.push([key,value]);return q;},update:(value:any)=>{patch=value;return q;},maybeSingle:async()=>{
   if(filters.some(([key,value])=>row[key]!==value))return {data:null};
   if(patch)Object.assign(row,patch);return {data:{...row}};
  }};return q;
 }};
 return {admin,job,profile,config};
}
const payload={to:"+15145551234",message:"Bonjour",idempotency_key:"ava-sms:job"};
describe("SMS job single-use authorization",()=>{
 it("rejects browser authorization even with a known job",async()=>{
  const {admin}=store();expect(await authorizeSmsJob(admin,false,MARC_SMS_USER_ID,"job","reply",payload)).toBeNull();
 });
 it("authorizes the exact reply once, never twice",async()=>{
  const {admin}=store();expect(await authorizeSmsJob(admin,true,MARC_SMS_USER_ID,"job","reply",payload)).not.toBeNull();
  expect(await authorizeSmsJob(admin,true,MARC_SMS_USER_ID,"job","reply",payload)).toBeNull();
 });
 it("refuses another recipient or edited body",async()=>{
  const {admin}=store();expect(await authorizeSmsJob(admin,true,MARC_SMS_USER_ID,"job","reply",{...payload,to:"+15145559999"})).toBeNull();
  expect(await authorizeSmsJob(admin,true,MARC_SMS_USER_ID,"job","reply",{...payload,message:"different"})).toBeNull();
 });
 it("revoked consent and stopped pilot prevent dispatch",async()=>{
  const {admin,profile,config}=store();profile.ai_consent_revoked_at="2026-10-31";
  expect(await authorizeSmsJob(admin,true,MARC_SMS_USER_ID,"job","reply",payload)).toBeNull();
  profile.ai_consent_revoked_at=null;config.enabled=false;
  expect(await authorizeSmsJob(admin,true,MARC_SMS_USER_ID,"job","reply",payload)).toBeNull();
 });
});