import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { planToolTypeTransition } from "./elevenlabs-tool-transition.ts";

Deno.test("détache seulement les outils dont le type doit changer", () => {
  const result = planToolTypeTransition(
    { tool_ids: ["keep", "email", "call", "unknown"] },
    [
      { id: "keep", tool_config: { name: "read_emails", type: "webhook" } },
      { id: "email", tool_config: { name: "reply_email", type: "webhook" } },
      { id: "call", tool_config: { name: "control_call", type: "webhook" } },
    ],
    new Map([
      ["read_emails", "webhook"],
      ["reply_email", "client"],
      ["control_call", "client"],
    ]),
  );

  assertEquals(result.replaceNames, ["reply_email", "control_call"]);
  assertEquals(result.replaceIds, ["email", "call"]);
  assertEquals(result.retainedIds, ["keep", "unknown"]);
});

Deno.test("ne détache rien quand les types sont déjà conformes", () => {
  const result = planToolTypeTransition(
    { tool_ids: ["settings"] },
    [{ id: "settings", tool_config: { name: "update_app_setting", type: "client" } }],
    new Map([["update_app_setting", "client"]]),
  );

  assertEquals(result.replaceIds, []);
  assertEquals(result.retainedIds, ["settings"]);
});
