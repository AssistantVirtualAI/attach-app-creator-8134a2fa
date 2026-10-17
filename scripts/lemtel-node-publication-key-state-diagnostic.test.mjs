import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const scriptPath = resolve(root, 'infra/lemtel-resilience/node-secure-enrollment/lemtel-node-publication-key-state-diagnostic.sh');
const script = readFileSync(scriptPath, 'utf8');

test('key-state diagnostic is root-gated, fixed-path, read-only and redacted', () => {
  for (const expected of [
    'root_required',
    'node_role_required',
    "config='/etc/lemtel-node-publication'",
    "state='/var/lib/lemtel-node-publication'",
    'key_material_read=false',
    'filesystem_mutation=false',
    'network_access=false',
    'automatic_failover_enabled=false',
    'node_publication_key_state_diagnostic_status=complete',
  ]) assert.ok(script.includes(expected), expected);
  assert.match(script, /case "\$\{LEMTEL_NODE_KEY_DIAGNOSTIC_ROLE:-\}" in do_writer\|hostinger_standby/u);
  assert.doesNotMatch(script, /(?:curl|wget|ssh|scp|rsync|docker|systemctl|pg_ctl|pg_promote|rm\s|mv\s|cp\s|touch\s|tee\s|truncate|dd\s|chmod\s|chown\s|cat\s)/u);
  assert.doesNotMatch(script, /(?:PRIVATE_KEY|SECRET|TOKEN|PASSWORD|keys\.json.*(?:print|echo|printf))/u);
});

test('key-state diagnostic reports only allowlisted file-state categories', () => {
  for (const state of ['absent', 'invalid', 'insecure', 'secure']) assert.ok(script.includes(`printf '${state}'`), state);
  assert.match(script, /find "\$path" -mindepth 1 -maxdepth 1 -printf '\.'/u);
  assert.doesNotMatch(script, /find .*?(?:-print(?:\s|$)|-ls(?:\s|$)|-exec(?:\s|$))/u);
});
