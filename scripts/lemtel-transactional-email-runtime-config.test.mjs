import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const scriptPath = resolve(root, 'infra/lemtel-self-hosted/transactional-email-runtime-config/lemtel-transactional-email-runtime-configure.sh');
const script = readFileSync(scriptPath, 'utf8');

test('runtime configuration is DigitalOcean writer-only, root-only, reviewed, and snapshot-attested', () => {
  assert.match(script, /\[ "\$\(id -u\)" -eq 0 \] \|\| fail root_required/);
  assert.match(script, /operator_review_required/);
  assert.match(script, /snapshot_attestation_required/);
  assert.match(script, /\[ "\$operator_review" = yes \]/);
  assert.match(script, /\[ "\$snapshot_review" = yes \]/);
  assert.match(script, /writer=digitalocean_writer/);
  assert.match(script, /automatic_failover_enabled=false/);
});

test('runtime configuration creates only a root-owned non-secret sender overlay and uses the local Lemtel wordmark fallback', () => {
  assert.match(script, /LEMTEL_WELCOME_FROM=Lemtel <notifications@ava-telecom\.ca>/);
  assert.match(script, /runtime_sender_identity_configured=true/);
  assert.match(script, /inline_lemtel_wordmark_fallback=true/);
  assert.match(script, /install -d -o root -g root -m 0700/);
  assert.match(script, /chmod 0600 "\$environment_file" "\$override_file"/);
  assert.match(script, /env_file:/);
  assert.doesNotMatch(script, /LEMTEL_EMAIL_LOGO_URL=/);
  assert.doesNotMatch(script, /RESEND_API_KEY=/);
  assert.doesNotMatch(script, /read -[a-z]*s/);
});

test('runtime configuration preserves the existing key by name and validates a Compose overlay before recreating only Edge', () => {
  assert.match(script, /has_current_environment_name RESEND_API_KEY \|\| fail resend_api_key_not_present/);
  assert.match(script, /compose_resend_key_declaration_missing/);
  assert.match(script, /compose_override_invalid/);
  assert.match(script, /--no-deps --force-recreate "\$service_name"/);
  assert.match(script, /has_configured_environment_name RESEND_API_KEY \|\| fail_stage resend_api_key_not_preserved/);
  assert.match(script, /has_configured_environment_name LEMTEL_WELCOME_FROM \|\| fail_stage sender_not_present_after_recreate/);
  assert.match(script, /resend_api_key_preserved=true/);
  assert.doesNotMatch(script, /docker restart/);
  assert.doesNotMatch(script, /docker compose up/);
});

test('runtime configuration carries a rollback path and emits no key or configuration values', () => {
  assert.match(script, /restore_configuration\(\)/);
  assert.match(script, /rollback_attempted=/);
  assert.match(script, /credential_values_emitted=false/);
  assert.match(script, /configuration_values_emitted=false/);
  assert.match(script, /secret_values_emitted=false/);
  for (const forbidden of ['curl ', 'wget ', 'ssh ', 'scp ', 'rsync ', 'pg_promote', 'ALTER ', 'INSERT ', 'UPDATE ', 'DELETE ', 'DROP ']) {
    assert.ok(!script.includes(forbidden), `unexpected ${forbidden}`);
  }
});

test('runtime configurator remains valid Bash', () => {
  execFileSync('bash', ['-n', scriptPath], { stdio: 'pipe' });
});
