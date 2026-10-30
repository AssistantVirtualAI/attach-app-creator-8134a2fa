// Marc-only AVA SMS watcher: reads 1136's recent message sessions straight from
// NetSapiens (the provider does not deliver message webhooks to us), saves new
// inbound texts and hands each one to pp-ava-sms exactly once (job claim on message_id).
import { MARC_SMS_PROFILE_ID, MARC_SMS_USER_ID, pilotInboundRow, pilotOwner, sessionNeedsRead } from "./ava-sms-policy.ts";
import { handoffCommand, providerHumanOutbound } from "./ava-sms-handoff.ts";

declare const Deno: { env: { get(name: string): string | undefined } };
const AVA_ORG_ID = "17d6507f-a9ca-409d-8e49-371d50332615";
const NS_BASE = () => (Deno.env.get("NS_API_BASE_URL") ?? "https://voice.ava-telecom.ca/ns-api/v2").replace(/\/$/, "");

export async function nsGet(path: string): Promise<any[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(`${NS_BASE()}${path}`, { headers: { Authorization: `Bearer ${Deno.env.get("NS_API_KEY") ?? ""}`, Accept: "application/json" }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`ns_${res.status}`);
    const data = await res.json().catch(() => null);
    return Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
  } finally { clearTimeout(timer); }
}

export const marcSessionMessagesPath = (sessionId: string) =>
  `/domains/planipret.ca/users/1136/messagesessions/${encodeURIComponent(sessionId)}/messages?limit=100`;

export async function runAvaSmsWatch(admin: any) {
  const { data: config } = await admin.from("planipret_ava_sms_pilot").select("enabled,activated_at,profile_id").eq("user_id", MARC_SMS_USER_ID).maybeSingle();
  if (!config?.enabled || !config.activated_at || config.profile_id !== MARC_SMS_PROFILE_ID) return { skipped: "pilot_disabled" };
  const { data: profile } = await admin.from("planipret_profiles").select("id,user_id,extension,ns_domain").eq("id", MARC_SMS_PROFILE_ID).maybeSingle();
  if (!profile || !pilotOwner(profile)) return { skipped: "pilot_identity_unverified" };

  const sessions = await nsGet("/domains/planipret.ca/users/1136/messagesessions?limit=20");
  const {data:avaJobs,error:avaError}=await admin.from("planipret_ava_sms_jobs").select("reply").eq("user_id",MARC_SMS_USER_ID).gte("created_at",config.activated_at);
  if(avaError)throw new Error("handoff_history_unavailable");
  const avaBodies=new Set<string>((avaJobs??[]).map((j:any)=>String(j.reply??"").trim()));
  const {data:sent,error:sentError}=await admin.from("planipret_phone_messages").select("ns_message_id").eq("user_id",MARC_SMS_PROFILE_ID).like("idempotency_key","ava-sms:%");
  if(sentError)throw new Error("handoff_history_unavailable");
  const avaIds=new Set<string>((sent??[]).map((r:any)=>String(r.ns_message_id??"")));
  const rows: any[] = [];
  // Read recently updated sessions even when Marc had the last word: human
  // messages must establish takeover before a later inbound can be answered.
  for (const s of sessions.filter((x) => sessionNeedsRead({...x,"messagesession-last-sender":""}, config.activated_at)).slice(0, 5)) {
    const msgs = await nsGet(marcSessionMessagesPath(String(s["messagesession-id"])));
    for (const m of msgs) {
      const human=providerHumanOutbound(m,avaBodies,config.activated_at,avaIds);
      if(human)await handoffCommand(admin,"takeover",human);
      const row = pilotInboundRow(m, MARC_SMS_PROFILE_ID, AVA_ORG_ID);
      if (row && Date.parse(row.sent_at) >= Date.parse(config.activated_at)) rows.push(row);
    }
  }
  const { error } = rows.length?await admin.from("planipret_phone_messages").upsert(rows, { onConflict: "ns_message_id", ignoreDuplicates: true }):{error:null};
  if (error) throw new Error(`save_failed:${error.code ?? ""}`);
  const { data: saved } = await admin.from("planipret_phone_messages").select("id,sent_at").eq("user_id", MARC_SMS_PROFILE_ID)
    .in("ns_message_id", rows.map((r) => r.ns_message_id)).order("sent_at", { ascending: true });
  const ids = (saved ?? []).map((r: any) => r.id);
  const { data: jobs } = ids.length ? await admin.from("planipret_ava_sms_jobs").select("message_id").in("message_id", ids) : { data: [] };
  const claimed = new Set((jobs ?? []).map((j: any) => j.message_id));
  const pending=await handoffCommand(admin,"queue_list");
  const pendingIds:string[]=Object.keys(pending.queue??{});
  const candidates=[...new Set([...pendingIds,...ids.filter((x:string)=>!claimed.has(x))])];
  let processed = 0;
  for (const id of candidates.slice(0, 5)) {
    const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/pp-ava-sms`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
      body: JSON.stringify({ action: "process", message_id: id }),
    });
    await res.text().catch(() => "");
    processed++;
  }
  return { sessions: sessions.length, inbound: rows.length, processed };
}
