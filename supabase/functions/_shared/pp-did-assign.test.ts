import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assignNumberToExtension } from "./pp-did-routing.ts";

type Store = { pn: Record<string, any>; sms: Record<string, any>; users: Record<string, any> };
function mock(store: Store, opts: { failCid?: boolean } = {}) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const p = url.pathname.replace(/.*\/domains\/[^/]+/, "");
    const m = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const res = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s });
    if (p === "/users") return res(Object.keys(store.users).map((u) => ({ user: u })));
    if (p === "/phonenumbers") return res(Object.entries(store.pn).map(([k, v]) => ({ phonenumber: k, ...v })));
    let mm = p.match(/^\/phonenumbers\/(\d+)$/);
    if (mm) { if (!store.pn[mm[1]]) return res({}, 404); if (m === "PUT") Object.assign(store.pn[mm[1]], body); return res(store.pn[mm[1]]); }
    mm = p.match(/^\/smsnumbers\/(\d+)$/);
    if (mm) { if (m === "PUT") store.sms[mm[1]] = body; return res(store.sms[mm[1]] ?? {}); }
    mm = p.match(/^\/users\/(\d+)$/);
    if (mm) { if (m === "PUT" && !opts.failCid) Object.assign(store.users[mm[1]], body); return res(store.users[mm[1]]); }
    return res({}, 404);
  }) as typeof fetch;
}
const D = "planipret.ca";

Deno.test("nouveau numéro : appels, textos et numéro affiché confirmés; ancien libéré", async () => {
  const s: Store = { pn: { "15145550001": {}, "15145550002": { "dial-rule-translation-destination-user": "1137" } }, sms: {}, users: { "1137": {} } };
  mock(s);
  const r = await assignNumberToExtension(D, "514-555-0001", "1137", { releaseOthers: true });
  assertEquals(r.success, true);
  assertEquals(s.users["1137"]["caller-id-number"], "5145550001");
  assertEquals(s.sms["15145550001"].dest, "1137");
  assertEquals(r.steps.released, [{ number: "15145550002", ok: true }]);
});

Deno.test("numéro textos seulement : refusé sans écriture", async () => {
  const s: Store = { pn: {}, sms: {}, users: { "1137": {} } };
  mock(s);
  const r = await assignNumberToExtension(D, "5145550009", "1137");
  assertEquals(r.error_code, "sms_only_number");
  assertEquals(Object.keys(s.sms).length, 0);
});

Deno.test("numéro déjà utilisé par un autre poste : refusé", async () => {
  const s: Store = { pn: { "15145550001": { "dial-rule-translation-destination-user": "1117" } }, sms: {}, users: { "1137": {}, "1117": {} } };
  mock(s);
  const r = await assignNumberToExtension(D, "5145550001", "1137");
  assertEquals(r.error_code, "number_in_use");
});

Deno.test("échec du numéro affiché : signalé comme partiel", async () => {
  const s: Store = { pn: { "15145550001": {} }, sms: {}, users: { "1137": {} } };
  mock(s, { failCid: true });
  const r = await assignNumberToExtension(D, "5145550001", "1137");
  assertEquals(r.success, false);
  assertEquals(r.steps.caller_id, false);
});
