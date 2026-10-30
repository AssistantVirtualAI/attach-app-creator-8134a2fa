import { MARC_SMS_USER_ID, MARC_SMS_PROFILE_ID, smsPeer, pilotOwner } from "./ava-sms-policy.ts";
import { handoffPaused } from "./ava-sms-handoff.ts";
// Only a server credential and a persisted, single-use decision can authorize automation.
export async function authorizeSmsJob(admin: any, serviceAuthenticated: boolean, userId: string, jobId: unknown, kind: "reply" | "calendar", payload: any) {
  if (!serviceAuthenticated || userId !== MARC_SMS_USER_ID || typeof jobId !== "string") return null;
  const { data: config } = await admin.from("planipret_ava_sms_pilot").select("enabled,profile_id").eq("user_id", userId).maybeSingle();
  if (!config?.enabled || config.profile_id !== MARC_SMS_PROFILE_ID) return null;
  const {data:profile}=await admin.from("planipret_profiles").select("id,user_id,extension,ns_domain,ava_chat_enabled,ai_consent_at,ai_consent_revoked_at").eq("user_id",userId).eq("id",MARC_SMS_PROFILE_ID).maybeSingle();
  if(!profile||!pilotOwner(profile)||profile.ava_chat_enabled===false||!profile.ai_consent_at||(profile.ai_consent_revoked_at&&profile.ai_consent_revoked_at>=profile.ai_consent_at))return null;
  const { data: job } = await admin.from("planipret_ava_sms_jobs").select("*").eq("id",jobId).eq("user_id",userId).eq("profile_id",MARC_SMS_PROFILE_ID).maybeSingle();
  if (!job || !["ready","approved"].includes(job.status)) return null;
  if (kind === "reply" && (smsPeer(payload.to) !== job.peer || payload.message !== job.reply || payload.idempotency_key !== `ava-sms:${job.id}`)) return null;
  if (kind === "calendar" && (job.proposal?.kind !== "appointment" || payload.start !== job.proposal.start || payload.end !== job.proposal.end)) return null;
  if (await handoffPaused(admin, job.peer, job.id)) return null;
  const column = kind === "reply" ? "reply_claimed_at" : "calendar_claimed_at";
  const { data: claimed } = await admin.from("planipret_ava_sms_jobs").update({[column]:new Date().toISOString()}).eq("id",job.id).eq("status",job.status).is(column,null).select("id").maybeSingle();
  return claimed ? job : null;
}