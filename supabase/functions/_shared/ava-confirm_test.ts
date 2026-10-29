import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { buildIdempotencyKey } from "./ava-confirm.ts";

Deno.test("forwarded executor key never collides with downstream reservation", async () => {
  const userId = "u1";
  const exec = await buildIdempotencyKey({ userId, action: "send_email", provided: "client-key" });
  const down = await buildIdempotencyKey({ userId, action: "ms365:send_email", provided: exec, scoped: true });
  assertNotEquals(down, exec);
  assertEquals(down, await buildIdempotencyKey({ userId, action: "ms365:send_email", provided: exec, scoped: true }));
});
