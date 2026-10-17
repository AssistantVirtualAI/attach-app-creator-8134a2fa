import { assertEquals } from "jsr:@std/assert@1";
import { createHandler, selectOwnedCall } from "./index.ts";
Deno.test("handoff refuses another extension and unlisted call id", () => {
  assertEquals(selectOwnedCall([{ "call-id": "a", user: "201" }], "200", "a"), null);
  assertEquals(selectOwnedCall([{ "call-id": "a", user: "200" }], "200", "foreign"), null);
});
Deno.test("handoff refuses ambiguous calls and selects own scoped call", () => {
  assertEquals(selectOwnedCall([{ "call-id": "a" }, { "call-id": "b" }], "200"), null);
  assertEquals(selectOwnedCall([{ "call-id": "a", user: "200" }], "200", "a")?.["call-id"], "a");
});

Deno.test("canonical widget and mobile ignore stored W", async () => {
  const { widgetDeviceId, mobileDeviceId } = await import("../_shared/pp-device-ids.ts");
  assertEquals(widgetDeviceId("200"), "200x");
  assertEquals(mobileDeviceId("200"), "200M");
});

// Synthetic transport responses exercise the documented active-resource contract
// (docs/netsapiens/calls.md:16–17), NOT production lifecycle fields or statuses.
const own = { "call-id": "a", user: "200", "call-remote-call-id": "remote-a" };
function setup(options: {
  extension?: string; list?: unknown; detail?: unknown; detailStatus?: number;
  invalidDetail?: boolean; machineProof?: boolean; authenticated?: boolean;
  transferStatus?: number; registered?: boolean;
} = {}) {
  const requests: { path: string; method: string; body: unknown }[] = [];
  const lookups: string[] = [];
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
  const run = createHandler({
    env: (name) => name === "MAESTRO_MACHINE_API_KEY" ? "test-machine" : name === "SUPABASE_SERVICE_ROLE_KEY" ? "test-service" : undefined,
    broker: async () => options.authenticated === false ? json({}, 401) : { ctx: { extension: options.extension ?? "200", nsDomain: "fixture.invalid" } },
    machineBroker: async (id) => {
      lookups.push(id);
      return options.machineProof === false ? null : { extension: options.extension ?? "200", nsDomain: "fixture.invalid" };
    },
    provider: async (path, init) => {
      requests.push({ path, method: init.method ?? "GET", body: init.body });
      if (path.endsWith("/registrations")) return json([{ device: `${options.extension ?? "200"}x`, state: options.registered === false ? "unregistered" : "registered" }]);
      if (path.endsWith("/calls")) return json(options.list ?? [own]);
      if (path.endsWith("/calls/a")) return options.invalidDetail ? new Response("not-json") : json(options.detail ?? own, options.detailStatus ?? 200);
      if (path.endsWith("/transfer")) return json({}, options.transferStatus ?? 200);
      throw new Error("Unexpected provider operation");
    },
  });
  return {
    requests, lookups,
    async invoke(body: unknown = { target: "widget", call_id: "a" }, token = "test-jwt") {
      const response = await run(new Request("https://fixture.invalid/handoff", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
      }));
      return { status: response.status, data: await response.json() };
    },
  };
}
function noTransfer(test: ReturnType<typeof setup>) {
  assertEquals(test.requests.filter((request) => request.method !== "GET"), []);
}
Deno.test("JWT owner with fresh active-resource evidence requests transfer only", async () => {
  const test = setup();
  assertEquals(await test.invoke(), { status: 200, data: { ok: true, status: "handoff_requested", error_code: null } });
  assertEquals(test.requests.map(({ method, path }) => [method, path]), [
    ["GET", "/domains/fixture.invalid/users/200/registrations"],
    ["GET", "/domains/fixture.invalid/users/200/calls"],
    ["GET", "/domains/fixture.invalid/users/200/calls/a"],
    ["PATCH", "/domains/fixture.invalid/users/200/calls/remote-a/transfer"],
  ]);
  assertEquals(JSON.parse(String(test.requests[3]?.body)), { destination: "sip:200x@fixture.invalid" });
  assertEquals(test.lookups, []);
});
Deno.test("JWT other broker cannot request owner's call", async () => {
  const test = setup({ extension: "201" });
  assertEquals((await test.invoke()).status, 403); noTransfer(test);
});
Deno.test("absent call is refused", async () => {
  const test = setup({ list: [] });
  assertEquals((await test.invoke()).status, 403); noTransfer(test);
});
Deno.test("terminated call removed from fresh active resource is refused", async () => {
  const test = setup({ detailStatus: 404 });
  assertEquals((await test.invoke()).data.error_code, "call_active_unconfirmed"); noTransfer(test);
});
Deno.test("deleted call absent from fresh active resource is refused", async () => {
  const test = setup({ detail: [] });
  assertEquals((await test.invoke()).data.error_code, "call_active_unconfirmed"); noTransfer(test);
});
Deno.test("unknown active state on failed provider read is refused", async () => {
  const test = setup({ detailStatus: 503 });
  assertEquals((await test.invoke()).status, 409); noTransfer(test);
});
Deno.test("ambiguous active evidence is refused even with one matching id", async () => {
  const test = setup({ detail: [own, { ...own, "call-id": "b" }] });
  assertEquals((await test.invoke()).status, 409); noTransfer(test);
});
Deno.test("malformed active evidence is refused", async () => {
  const test = setup({ invalidDetail: true });
  assertEquals((await test.invoke()).status, 409); noTransfer(test);
});
Deno.test("fresh active resource must match requested id", async () => {
  const test = setup({ detail: { ...own, "call-id": "b" } });
  assertEquals((await test.invoke()).status, 409); noTransfer(test);
});
Deno.test("fresh active resource must match resolved owner", async () => {
  const test = setup({ detail: { ...own, user: "201" } });
  assertEquals((await test.invoke()).status, 409); noTransfer(test);
});
Deno.test("machine lookup requires unique server broker proof", async () => {
  const test = setup({ machineProof: false });
  assertEquals((await test.invoke({ target: "widget", user_id: "maestro-fixture", call_id: "a" }, "test-machine")).status, 403);
  assertEquals(test.lookups, ["maestro-fixture"]); assertEquals(test.requests, []);
});
Deno.test("machine path accepts server resolved owner's active call", async () => {
  const test = setup();
  assertEquals((await test.invoke({ target: "widget", user_id: "maestro-fixture", call_id: "a" }, "test-machine")).data.status, "handoff_requested");
  assertEquals(test.lookups, ["maestro-fixture"]);
});
Deno.test("machine path cannot access another resolved broker's call", async () => {
  const test = setup({ extension: "201" });
  assertEquals((await test.invoke({ target: "widget", user_id: "maestro-fixture", call_id: "a" }, "test-machine")).status, 403); noTransfer(test);
});
Deno.test("machine path rejects client broker_user_id", async () => {
  const test = setup();
  assertEquals((await test.invoke({ target: "widget", user_id: "maestro-fixture", broker_user_id: "200" }, "test-machine")).status, 400);
  assertEquals(test.lookups, []); assertEquals(test.requests, []);
});
Deno.test("JWT path rejects client identity override", async () => {
  const test = setup();
  assertEquals((await test.invoke({ target: "widget", user_id: "other" })).status, 400); assertEquals(test.requests, []);
});
Deno.test("invalid JWT is refused before provider access", async () => {
  const test = setup({ authenticated: false });
  assertEquals((await test.invoke()).status, 401); assertEquals(test.requests, []);
});
Deno.test("service credential cannot act as a broker", async () => {
  const test = setup();
  assertEquals((await test.invoke(undefined, "test-service")).status, 401); assertEquals(test.requests, []);
});
Deno.test("provider refusal is not reported as handoff acceptance", async () => {
  const test = setup({ transferStatus: 500 });
  assertEquals((await test.invoke()).data, { ok: false, status: "failed", error_code: "provider_refused" });
});
Deno.test("target not registered causes no transfer", async () => {
  const test = setup({ registered: false });
  assertEquals((await test.invoke()).status, 409); noTransfer(test);
});
Deno.test("missing remote leg in fresh evidence cannot use stale list leg", async () => {
  const test = setup({ detail: { "call-id": "a", user: "200" } });
  assertEquals((await test.invoke()).data.error_code, "remote_leg_unavailable"); noTransfer(test);
});
Deno.test("status path reads registration only and never transfers", async () => {
  const test = setup();
  assertEquals((await test.invoke({ action: "status", target: "widget" })).data, { registered: true });
  assertEquals(test.requests.length, 1); noTransfer(test);
});
