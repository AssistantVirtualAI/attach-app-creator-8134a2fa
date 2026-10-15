import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { run, summarizeTransactionalEmailDiagnostic } from "./lemtel-transactional-email-diagnostic.mjs";

test("transactional email diagnostic emits only approved booleans and status counts", () => {
  const report = summarizeTransactionalEmailDiagnostic({
    mailConfiguration: { providerApiConfigured: true, senderConfigured: true, logoConfigured: false, webhookSecretConfigured: true, apiKey: "must-not-leave" },
    publisher: { present: true, endpoint: "private.example.invalid" },
    deliveryAttempts: { pending: 2, provider_accepted: 3, delivered: 1, failed: 4, needs_attention: 5, recipient: "person@example.test", password: "must-not-leave" },
    rawPayload: "must-not-leave",
  });
  assert.deepEqual(report.delivery_attempt_counts, { pending: 2, provider_accepted: 3, delivered: 1, failed: 4, needs_attention: 5 });
  assert.equal(report.deployment_authorized, false);
  assert.equal(report.email_send_authorized, false);
  const serialized = JSON.stringify(report);
  for (const forbidden of ["must-not-leave", "person@example.test", "private.example.invalid", "password", "payload", "apiKey"]) assert.doesNotMatch(serialized, new RegExp(forbidden, "i"));
});

test("diagnostic package is source-only and never reads secrets, contacts providers, deploys, or writes", () => {
  const source = readFileSync(resolve(import.meta.dirname, "lemtel-transactional-email-diagnostic.mjs"), "utf8");
  assert.equal(run('{"deliveryAttempts":{"pending":7}}').code, 78);
  assert.doesNotMatch(source, /process\.env|\bfetch\s*\(|child_process|\bspawn\s*\(|\bexec(?:File)?\s*\(|writeFile|docker|curl|wget|ssh|psql|resend/i);
});
