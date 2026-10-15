#!/usr/bin/env node
// Source-only diagnostic: no network, environment reads, writes, deployment, or email sending.
const STATES = ["pending", "provider_accepted", "delivered", "failed", "needs_attention"];
const MAX_COUNT = 1_000_000_000;
const plainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const boolean = (value) => value === true;
const count = (value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_COUNT ? value : 0;

/** Reduces a manually supplied, already-redacted summary to the only permitted diagnostic fields. */
export function summarizeTransactionalEmailDiagnostic(raw) {
  const input = plainObject(raw) ? raw : {};
  const mail = plainObject(input.mailConfiguration) ? input.mailConfiguration : {};
  const publisher = plainObject(input.publisher) ? input.publisher : {};
  const attempts = plainObject(input.deliveryAttempts) ? input.deliveryAttempts : {};
  return {
    status: "transactional_email_diagnostic_source_only",
    deployment_authorized: false,
    email_send_authorized: false,
    mail_configuration: {
      provider_api_configured: boolean(mail.providerApiConfigured),
      sender_configured: boolean(mail.senderConfigured),
      logo_configured: boolean(mail.logoConfigured),
      webhook_secret_configured: boolean(mail.webhookSecretConfigured),
    },
    publisher: { present: boolean(publisher.present) },
    delivery_attempt_counts: Object.fromEntries(STATES.map((state) => [state, count(attempts[state])])),
  };
}

export function run(argument = process.argv[2]) {
  let input = {};
  try { if (argument) input = JSON.parse(argument); } catch { /* Invalid summaries are safely reduced to zero information. */ }
  return { code: 78, stdout: `${JSON.stringify(summarizeTransactionalEmailDiagnostic(input))}\n` };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const result = run();
  process.stdout.write(result.stdout);
  process.exitCode = result.code;
}
