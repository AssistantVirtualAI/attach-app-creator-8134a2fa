import { assertEquals } from "jsr:@std/assert@1.0.14";
import { validateBody } from "./index.ts";

Deno.test("portal list action accepts only its exact body", () => {
  assertEquals(validateBody({ action: "list_organizations" }), { action: "list_organizations" });
  assertEquals(validateBody({ action: "list_organizations", ignored: true }), { error: "invalid_body", status: 400 });
});

Deno.test("create organization requires Lemtel-only names and owner role", () => {
  assertEquals(validateBody({
    action: "create_organization",
    organization: { displayName: "Lemtel : Staging", slug: "lemtel-staging", defaultLocale: "fr" },
    owner: { email: "owner@example.com", displayName: "Owner", role: "owner", locale: "fr" },
    users: [],
  }), {
    action: "create_organization",
    organization: { displayName: "Lemtel : Staging", slug: "lemtel-staging", defaultLocale: "fr" },
    owner: { email: "owner@example.com", displayName: "Owner", role: "owner", locale: "fr" },
    users: [],
  });
});

Deno.test("user provisioning rejects deprecated non-Lemtel roles", () => {
  assertEquals(validateBody({
    action: "provision_users",
    organizationId: "11111111-1111-4111-8111-111111111111",
    users: [{ email: "member@example.com", displayName: "Member", role: "manager", locale: "en" }],
  }), { error: "invalid_role", status: 400 });
});

Deno.test("revoke action requires an exact pair of Lemtel UUIDs", () => {
  assertEquals(validateBody({ action: "revoke_invitation", organizationId: "bad", recipientUserId: "bad" }), { error: "invalid_organization_id", status: 400 });
});
