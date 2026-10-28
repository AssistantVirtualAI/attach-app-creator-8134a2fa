import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assignNumberToExtension, reconcileVoiceSmsNumber } from "./pp-did-routing.ts";

type Store = { pn: Record<string, any>; sms: Record<string, any>; users: Record<string, any> };
function mock(store: Store, opts: { failCid?: boolean; hiddenPool?: boolean; staleOwner?: string; missingTarget?: boolean; smsWriteFail?: boolean } = {}) {
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
    if (mm) {
      if (m === "PUT") { if (opts.smsWriteFail) return res({}, 403); store.sms[mm[1]] = body; }
      if (m === "GET" && opts.hiddenPool) return res({}, 404);
      return res(store.sms[mm[1]] ?? {});
    }
    mm = p.match(/^\/users\/(\d+)\/smsnumbers$/);
    if (mm) {
      const owner = mm[1];
      const rows = Object.entries(store.sms).filter(([, v]) => v.dest === owner).map(([number, v]) => ({ number, ...v }));
      if (opts.staleOwner === owner) rows.push({ number: "14389534902", dest: owner });
      return res({ smsnumbers: opts.missingTarget ? [] : rows });
    }
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

Deno.test("1372 reprend automatiquement le SMS 4389534902 de 1103 sans changer le propriétaire voix", async () => {
  const s: Store = { pn: { "14389534902": { "dial-rule-translation-destination-user": "1372" } }, sms: { "14389534902": { application: "user", dest: "1103" } }, users: { "1372": {}, "1103": {} } };
  mock(s);
  const r = await assignNumberToExtension(D, "4389534902", "1372");
  assertEquals(r.success, true);
  assertEquals(s.sms["14389534902"].dest, "1372");
  assertEquals(s.pn["14389534902"]["dial-rule-translation-destination-user"], "1372");
});

Deno.test("numéro assigné absent du pool : vérification par le sous-endpoint du nouveau courtier", async () => {
  const s: Store = { pn: { "14389534902": {} }, sms: {}, users: { "1372": {} } };
  mock(s, { hiddenPool: true });
  const r = await assignNumberToExtension(D, "4389534902", "1372");
  assertEquals(r.success, true);
  assertEquals(s.sms["14389534902"].dest, "1372");
});

Deno.test("ancien propriétaire SMS conserve une copie : assignation non confirmée", async () => {
  const s: Store = { pn: { "14389534902": {} }, sms: { "14389534902": { application: "user", dest: "1103" } }, users: { "1372": {}, "1103": {} } };
  mock(s, { staleOwner: "1103" });
  const r = await assignNumberToExtension(D, "4389534902", "1372");
  assertEquals(r.success, false);
  assertEquals(r.steps.sms, false);
});

Deno.test("SMS absent du compte cible : ne libère pas l'ancien numéro voix du courtier", async () => {
  const s: Store = { pn: { "14389534902": {}, "15145550002": { "dial-rule-translation-destination-user": "1372" } }, sms: {}, users: { "1372": {} } };
  mock(s, { missingTarget: true });
  const r = await assignNumberToExtension(D, "4389534902", "1372", { releaseOthers: true });
  assertEquals(r.success, false);
  assertEquals(r.steps.sms, false);
  assertEquals(s.pn["15145550002"]["dial-rule-translation-destination-user"], "1372");
});

Deno.test("refus fournisseur SMS : aucune réussite annoncée", async () => {
  const s: Store = { pn: { "14389534902": {} }, sms: {}, users: { "1372": {} } };
  mock(s, { smsWriteFail: true });
  const r = await assignNumberToExtension(D, "4389534902", "1372");
  assertEquals(r.success, false);
  assertEquals(r.steps.sms, false);
});

Deno.test("vérification des comptes existants reste en lecture seule", async () => {
  const s: Store = { pn: { "14389534902": { "dial-rule-translation-destination-user": "1372" } }, sms: { "14389534902": { application: "user", dest: "1103" } }, users: { "1372": {}, "1103": {} } };
  mock(s);
  const before = JSON.stringify(s);
  const result = await reconcileVoiceSmsNumber(D, "4389534902", "1372");
  assertEquals(result.ok, false);
  assertEquals(result.repaired, false);
  assertEquals(JSON.stringify(s), before);
});

Deno.test("réparation SMS des comptes existants suit le propriétaire voix pour tous les postes", async () => {
  for (const ext of ["1372", "1117", "1136", "1284"]) {
    const s: Store = { pn: { "14389534902": { "dial-rule-translation-destination-user": ext } }, sms: { "14389534902": { application: "user", dest: "1103" } }, users: { [ext]: {}, "1103": {} } };
    mock(s);
    const result = await reconcileVoiceSmsNumber(D, "4389534902", ext, true);
    assertEquals(result.ok, true);
    assertEquals(result.repaired, true);
    assertEquals(s.sms["14389534902"].dest, ext);
    assertEquals(s.pn["14389534902"]["dial-rule-translation-destination-user"], ext);
  }
});

Deno.test("réparation SMS refuse une propriété voix différente et ne modifie rien", async () => {
  const s: Store = { pn: { "14389534902": { "dial-rule-translation-destination-user": "1117" } }, sms: { "14389534902": { application: "user", dest: "1103" } }, users: { "1372": {}, "1103": {}, "1117": {} } };
  mock(s);
  const before = JSON.stringify(s);
  const result = await reconcileVoiceSmsNumber(D, "4389534902", "1372", true);
  assertEquals(result.ok, false);
  assertEquals(JSON.stringify(s), before);
});
