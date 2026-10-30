// Execute the actual draft SQL in isolated PostgreSQL, never the live backend.
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { Blob } from "node:buffer";
import { MARC_SMS_USER_ID } from "../supabase/functions/_shared/ava-sms-policy";
const db=new PGlite({fsBundle:new Blob([readFileSync("node_modules/@electric-sql/pglite/dist/pglite.data")]) as unknown as globalThis.Blob});
const peer="+15145550101",other="+15145550102",job="00000000-0000-4000-8000-000000000001";
const command=async(op:string,args:Record<string,unknown>={},owner=MARC_SMS_USER_ID)=>{
 const result=await db.query<{state:any}>("select public.pp_ava_sms_handoff($1::uuid,$2,$3::jsonb) as state",[owner,op,JSON.stringify(args)]);
 return result.rows[0]?.state;
};
beforeAll(async()=>{await db.exec("create role anon; create role authenticated; create role service_role;");await db.exec(readFileSync("docs/planipret-ava-sms-handoff.sql","utf8"));},30000);
afterAll(async()=>{await db.close();});
describe("persisted SMS handoff",()=>{
 it("app open stops replies to every client, close resumes other conversations",async()=>{
  await command("presence",{session_id:"one",active:true});
  expect((await command("check",{peer})).paused).toBe(true);
  expect((await command("check",{peer:other})).paused).toBe(true);
  await command("presence",{session_id:"one",active:false});
  expect((await command("check",{peer:other})).paused).toBe(false);
 });
 it("a previous human reply never blocks a new client message when Marc is offline",async()=>{
  await command("presence",{session_id:"one",active:true});await command("takeover",{peer});
  expect((await command("check",{peer})).paused).toBe(true);
  await command("presence",{session_id:"one",active:false});
  expect((await command("check",{peer})).paused).toBe(false);
  expect((await command("check",{peer:other})).paused).toBe(false);
  expect((await command("begin",{peer,job_id:job})).allowed).toBe(true);
  await command("release",{job_id:job});
  await command("resume",{peer});expect((await command("check",{peer})).paused).toBe(false);
 });
 it("second foreground session prevents early resume",async()=>{
  await command("presence",{session_id:"one",active:true});await command("presence",{session_id:"two",active:true});
  await command("presence",{session_id:"one",active:false});expect((await command("check",{peer})).paused).toBe(true);
  await command("presence",{session_id:"two",active:false});expect((await command("check",{peer})).paused).toBe(false);
 });
 it("prepared dispatch cannot begin after foreground takeover",async()=>{
  await command("presence",{session_id:"one",active:true});expect((await command("begin",{peer,job_id:job})).allowed).toBe(false);
  await command("presence",{session_id:"one",active:false});
 });
 it("marks an in-flight operation pending and refuses new sends until released",async()=>{
  expect((await command("begin",{peer,job_id:job})).allowed).toBe(true);
  const state=await command("presence",{session_id:"one",active:true});expect(state.taking_over).toBe(true);
  expect((await command("check",{peer,job_id:job})).paused).toBe(true);
  await command("release",{job_id:job});await command("presence",{session_id:"one",active:false});
 });
 it("claims notification and voice greeting once per persisted handoff",async()=>{
  await command("save_summary",{peer,job_id:job,summary:"Test isolated summary"});
  expect((await command("notify_claim",{peer,job_id:job})).claimed).toBe(true);
  expect((await command("notify_claim",{peer,job_id:job})).claimed).toBe(false);
  expect((await command("greet",{peer,job_id:job})).claimed).toBe(true);
  expect((await command("greet",{peer,job_id:job})).claimed).toBe(false);
  await command("save_summary",{peer,job_id:job,summary:"Repeat"});
  expect((await command("status")).summaries[peer].summary).toBe("Test isolated summary");
 });
 it("failed voice playback releases only the matching summary version",async()=>{
  expect((await command("greet_failed",{peer,job_id:"00000000-0000-4000-8000-000000000099"})).claimed).toBe(false);
  expect((await command("greet",{peer,job_id:job})).claimed).toBe(false);
  await command("greet_failed",{peer,job_id:job});
  expect((await command("greet",{peer,job_id:job})).claimed).toBe(true);
  expect((await command("greet",{peer,job_id:job})).claimed).toBe(false);
 });
 it("rejects every non-pilot broker and gives browser roles no table or RPC access",async()=>{
  await expect(command("status",{},"00000000-0000-4000-8000-000000000002")).rejects.toThrow("pilot_only");
  const permissions=await db.query<{table_access:boolean;function_access:boolean}>("select has_table_privilege('authenticated','public.planipret_ava_sms_handoff_state','SELECT') as table_access, has_function_privilege('authenticated','public.pp_ava_sms_handoff(uuid,text,jsonb)','EXECUTE') as function_access");
  expect(permissions.rows[0]).toEqual({table_access:false,function_access:false});
 });
 it("a provider human observation is idempotent and cannot re-take-over a resumed thread",async()=>{
  await command("takeover",{peer,source_id:"human-row"});await command("resume",{peer});
  expect((await command("takeover",{peer,source_id:"human-row"})).duplicate).toBe(true);
  expect((await command("check",{peer})).paused).toBe(false);
 });
 it("retains suspended inbound work until a later drain",async()=>{
  const id="00000000-0000-4000-8000-000000000003";
  await command("queue",{peer,message_id:id});await command("presence",{session_id:"one",active:true});
  expect((await command("queue_list")).queue[id]).toBe(peer);
  await command("presence",{session_id:"one",active:false});expect((await command("queue_list")).queue[id]).toBe(peer);
  await command("dequeue",{message_id:id});expect((await command("queue_list")).queue[id]).toBeUndefined();
 });
 it("atomic adapter claim refuses presence without consuming the one-shot job",async()=>{
  await db.exec("create table public.planipret_ava_sms_jobs(id uuid,user_id uuid,peer text,status text,reply_claimed_at timestamptz,calendar_claimed_at timestamptz)");
  await db.query("insert into public.planipret_ava_sms_jobs(id,user_id,peer,status) values($1,$2,$3,'ready')",[job,MARC_SMS_USER_ID,peer]);
  await command("takeover",{peer});await command("begin",{peer,job_id:job});await command("presence",{session_id:"one",active:true});
  expect((await command("claim",{peer,job_id:job,kind:"reply",status:"ready"})).claimed).toBe(false);
  await command("presence",{session_id:"one",active:false});
  expect((await command("claim",{peer,job_id:job,kind:"reply",status:"ready"})).claimed).toBe(true);
  expect((await command("claim",{peer,job_id:job,kind:"reply",status:"ready"})).claimed).toBe(false);
  await command("release",{job_id:job});
 });
});