import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle, type Deps } from "./index.ts";

const TOKEN = "fcmTOKENabcdef1234567890SECRETVALUE";

function setup(opts: { upsertError?: unknown; canRegister?: boolean; user?: boolean } = {}) {
  const logs: string[] = [];
  const audits: unknown[] = [];
  const upserts: unknown[] = [];
  const sb = {
    auth: { getUser: async () => ({ data: { user: opts.user === false ? null : { id: "u1" } } }) },
    rpc: async () => ({ data: true }),
    from: (t: string) => t === "audit_logs"
      ? { insert: async (r: unknown) => { audits.push(r); return { error: null }; } }
      : { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { organization_id: "o1" } }) }) }) },
  };
  const admin = {
    from: () => ({ upsert: async (r: unknown) => { upserts.push(r); return { error: opts.upsertError ?? null }; } }),
  };
  const deps: Deps = {
    userClient: () => sb,
    adminClient: () => admin,
    canRegister: async () => opts.canRegister ?? true,
    log: (m, meta) => logs.push(m + JSON.stringify(meta ?? {})),
  };
  return { deps, logs, audits, upserts };
}

const req = (body: unknown, auth = true) =>
  new Request("http://x", {
    method: "POST",
    headers: auth ? { Authorization: "Bearer t", "Content-Type": "application/json" } : {},
    body: JSON.stringify(body),
  });

const android = { token: TOKEN, platform: "android", extension: "1136", device_id: "dev-1" };

function noToken(...texts: string[]) {
  for (const t of texts) for (const frag of [TOKEN, TOKEN.slice(0, 12), TOKEN.slice(0, 6), TOKEN.slice(-8)]) {
    assert(!t.includes(frag), "token data leaked");
  }
}

Deno.test("android token persists and returns ok", async () => {
  const s = setup();
  const r = await handle(req(android), s.deps);
  const txt = await r.text();
  assertEquals(r.status, 200);
  assertEquals(JSON.parse(txt), { ok: true });
  assertEquals(s.upserts.length, 1);
  noToken(txt, JSON.stringify(s.audits), s.logs.join());
});

Deno.test("persist failure returns non-2xx without success", async () => {
  const s = setup({ upsertError: { code: "23505", message: `dup ${TOKEN}` } });
  const r = await handle(req(android), s.deps);
  const txt = await r.text();
  assertEquals(r.status, 500);
  assertEquals(JSON.parse(txt), { error: "token_persist_failed" });
  assertEquals(s.audits.length, 0);
  noToken(txt, s.logs.join());
});

Deno.test("audit metadata has no token fields", async () => {
  const s = setup();
  await (await handle(req(android), s.deps)).text();
  const meta = (s.audits[0] as { metadata: Record<string, unknown> }).metadata;
  assertEquals(Object.keys(meta).sort(), ["extension", "platform"]);
});

Deno.test("unauthenticated rejected", async () => {
  const s = setup({ user: false });
  const r = await handle(req(android), s.deps);
  await r.text();
  assertEquals(r.status, 401);
  assertEquals(s.upserts.length, 0);
});

Deno.test("inactive device rejected", async () => {
  const s = setup({ canRegister: false });
  const r = await handle(req(android), s.deps);
  await r.text();
  assertEquals(r.status, 409);
  assertEquals(s.upserts.length, 0);
});
