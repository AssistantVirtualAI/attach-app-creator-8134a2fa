import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isCommissionQuestion } from "./ava-chat-routing.ts";

Deno.test("task close request with 'en attente' is not a commission question", () => {
  assertEquals(isCommissionQuestion("Ferme la tache en attente pour le new function copy client"), false);
  assertEquals(isCommissionQuestion("Close the pending task for ABH"), false);
});

Deno.test("commission questions still route to commissions", () => {
  assertEquals(isCommissionQuestion("Mes commissions en attente 2026"), true);
  assertEquals(isCommissionQuestion("c'est quoi le volume de Francis Marois?"), true);
  assertEquals(isCommissionQuestion("pending 2026"), true);
});
