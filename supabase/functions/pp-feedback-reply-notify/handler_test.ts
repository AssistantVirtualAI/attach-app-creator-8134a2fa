import { createHandler, type Dependencies } from "./handler.ts";
const cid = "00000000-0000-4000-8000-000000000001";
const rid = "00000000-0000-4000-8000-000000000002";
function fixture(overrides: Partial<Dependencies> = {}) {
  const calls: unknown[][] = [];
  const deps: Dependencies = {
    authenticate: async () => "admin", isAdmin: async () => true, isMember: async () => true,
    comment: async () => ({ id: cid, report_id: rid, author_id: "admin" }),
    report: async () => ({ id: rid, reporter_id: "reporter" }),
    email: async uid => { calls.push(["email_lookup", uid]); return "reporter@example.test"; },
    push: async (...args) => { calls.push(["push", ...args]); return { logged: true, delivered: 1 }; },
    sendEmail: async (...args) => { calls.push(["email", ...args]); return { sent: true }; },
    ...overrides,
  };
  const run = (body: unknown = { comment_id: cid }) => createHandler(deps)(new Request("http://localhost", {
    method: "POST", body: JSON.stringify(body),
  }));
  return { calls, run };
}
function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
Deno.test("admin reply targets only reporter with stable comment ID keys", async () => {
  const f = fixture(); const res = await f.run(); equal(res.status, 200);
  equal(f.calls, [["email_lookup", "reporter"], ["push", "reporter", rid, `feedback-reply:${cid}`], ["email", "reporter@example.test", rid, `feedback-reply:${cid}`]].sort(() => 0));
  const data = await res.json(); equal(data.email_status, "sent"); equal(data.push_status, "accepted");
});
Deno.test("retries reuse both channel keys", async () => {
  const f = fixture(); await f.run(); await f.run();
  const pushes = f.calls.filter(c => c[0] === "push"); equal(pushes.length, 2); equal(pushes[0], pushes[1]);
  const emails = f.calls.filter(c => c[0] === "email"); equal(emails[0], emails[1]);
});
Deno.test("signed out rejected without sends", async () => {
  const f = fixture({ authenticate: async () => null }); equal((await f.run()).status, 401); equal(f.calls, []);
});
Deno.test("another admin cannot notify for someone else's comment", async () => {
  const f = fixture({ authenticate: async () => "other" }); equal((await f.run()).status, 404); equal(f.calls, []);
});
Deno.test("reporter's own reply sends no notification", async () => {
  const f = fixture({ isAdmin: async () => false }); equal((await (await f.run()).json()).skipped, "not_admin_reply"); equal(f.calls, []);
});
Deno.test("admin self reply sends no notification", async () => {
  const f = fixture({ report: async () => ({ id: rid, reporter_id: "admin" }) }); equal((await (await f.run()).json()).skipped, "self_reply"); equal(f.calls, []);
});
Deno.test("missing comment refuses notification", async () => {
  const f = fixture({ comment: async () => null }); equal((await f.run()).status, 404); equal(f.calls, []);
});
Deno.test("missing report refuses notification", async () => {
  const f = fixture({ report: async () => null }); equal((await f.run()).status, 404); equal(f.calls, []);
});
Deno.test("non-member recipient refused", async () => {
  const f = fixture({ isMember: async () => false }); equal((await f.run()).status, 403); equal(f.calls, []);
});
Deno.test("browser cannot choose recipient", async () => {
  const f = fixture(); equal((await f.run({ comment_id: cid, to: "other@example.test" })).status, 400); equal(f.calls, []);
});
Deno.test("email lookup failure does not prevent push", async () => {
  const f = fixture({ email: async () => { throw new Error("unavailable"); } });
  const data = await (await f.run()).json(); equal(data.email_status, "failed"); equal(data.push_status, "accepted");
});
Deno.test("push failure does not prevent email", async () => {
  const f = fixture({ push: async () => { throw new Error("unavailable"); } });
  const data = await (await f.run()).json(); equal(data.push_status, "failed"); equal(data.email_status, "sent");
});
Deno.test("suppression is respected without retry", async () => {
  const f = fixture({ sendEmail: async () => ({ sent: false }) }); equal((await (await f.run()).json()).email_status, "suppressed");
});
Deno.test("no phone registration is unconfirmed, not delivery success", async () => {
  const f = fixture({ push: async () => ({ logged: true, delivered: 0 }) });
  const data = await (await f.run()).json(); equal(data.notification_logged, true); equal(data.push_status, "unconfirmed");
});