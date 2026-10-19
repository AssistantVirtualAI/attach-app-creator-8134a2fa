import { createClient } from "npm:@supabase/supabase-js@2";
import { sendTemplateEmail } from "../_shared/transactional-email-templates/send-email.ts";
import { createHandler } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(url, key, { auth: { persistSession: false } });
const read = async (table: string, id: string, columns: string) => {
  const { data, error } = await admin.from(table).select(columns).eq("id", id).maybeSingle();
  if (error) throw new Error("read_failed");
  return data;
};
const allowed = async (rpc: string, uid: string) => {
  const { data, error } = await admin.rpc(rpc, { _user_id: uid });
  return !error && data === true;
};
Deno.serve(createHandler({
  authenticate: async req => {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return null;
    const { data, error } = await admin.auth.getUser(token);
    return error ? null : data.user?.id ?? null;
  },
  isAdmin: uid => allowed("is_planipret_feedback_admin", uid),
  isMember: uid => allowed("is_planipret_member", uid),
  comment: async id => await read("pp_feedback_comments", id, "id,report_id,author_id") as any,
  report: async id => await read("pp_feedback_reports", id, "id,reporter_id") as any,
  email: async uid => {
    const { data, error } = await admin.auth.admin.getUserById(uid);
    if (error) throw new Error("recipient_lookup_failed");
    return data.user?.email ?? null;
  },
  push: async (uid, reportId, idempotencyKey) => {
    const path = `/mplanipret/feedback?report=${encodeURIComponent(reportId)}`;
    const res = await fetch(`${url}/functions/v1/pp-push-notify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: uid, category: "feedback_reply", title: "Réponse à votre feedback",
        body: "L’équipe a répondu. Consultez votre feedback dans l’application ou le portail.",
        deep_link: path, data: { type: "feedback_reply", url: path, deep_link: path },
        idempotency_key: idempotencyKey,
      }),
    });
    if (!res.ok) throw new Error("push_failed");
    const data = await res.json();
    if (data.error) throw new Error("push_failed");
    return { logged: data.logged === true || Number(data.delivered) > 0, delivered: Number(data.delivered) || 0 };
  },
  sendEmail: (email, reportId, idempotencyKey) => sendTemplateEmail("planipret-feedback-reply", email, {
    templateData: { reportId }, idempotencyKey,
  }),
}));