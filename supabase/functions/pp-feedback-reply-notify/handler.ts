export type Comment = { id: string; report_id: string; author_id: string };
export type Report = { id: string; reporter_id: string };
export type Dependencies = {
  authenticate(req: Request): Promise<string | null>;
  isAdmin(uid: string): Promise<boolean>;
  isMember(uid: string): Promise<boolean>;
  comment(id: string): Promise<Comment | null>;
  report(id: string): Promise<Report | null>;
  email(uid: string): Promise<string | null>;
  push(uid: string, reportId: string, key: string): Promise<{ logged: boolean; delivered: number }>;
  sendEmail(email: string, reportId: string, key: string): Promise<{ sent: boolean }>;
};
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createHandler(deps: Dependencies) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    try {
      const uid = await deps.authenticate(req);
      if (!uid) return json({ error: "not_authenticated" }, 401);
      const body = await req.json().catch(() => null);
      // Only an existing comment ID is accepted. Recipient/content are server-owned.
      if (!body || Object.keys(body).some(k => k !== "comment_id") ||
          typeof body.comment_id !== "string" || !uuid.test(body.comment_id)) {
        return json({ error: "invalid_body" }, 400);
      }
      const comment = await deps.comment(body.comment_id);
      if (!comment || comment.author_id !== uid) return json({ error: "not_found" }, 404);
      if (!(await deps.isAdmin(uid))) return json({ skipped: "not_admin_reply" });
      const report = await deps.report(comment.report_id);
      if (!report) return json({ error: "not_found" }, 404);
      if (report.reporter_id === uid) return json({ skipped: "self_reply" });
      if (!(await deps.isMember(report.reporter_id))) return json({ error: "not_authorized" }, 403);
      const key = `feedback-reply:${comment.id}`;
      const address = await deps.email(report.reporter_id);
      // Failure in one channel must not prevent the other channel.
      const [push, email] = await Promise.allSettled([
        deps.push(report.reporter_id, report.id, key),
        address ? deps.sendEmail(address, report.id, key) : Promise.resolve({ sent: false }),
      ]);
      return json({
        notification_logged: push.status === "fulfilled" && push.value.logged,
        push_status: push.status === "rejected" ? "failed" : push.value.delivered > 0 ? "accepted" : "unconfirmed",
        email_status: email.status === "rejected" ? "failed" : email.value.sent ? "sent" : address ? "suppressed" : "no_email",
      });
    } catch {
      return json({ error: "notification_unavailable" }, 503);
    }
  };
}