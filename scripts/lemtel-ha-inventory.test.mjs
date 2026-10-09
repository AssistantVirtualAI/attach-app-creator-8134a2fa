import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const inventoryPath = resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-inventory.sh');
const inventory = () => readFileSync(inventoryPath, 'utf8');

test('non-root Docker denial is explicit and never becomes an empty runtime inventory', () => {
  const source = inventory();
  const guard = source.indexOf("if ! docker ps --format '{{.Names}}' >/dev/null 2>&1; then");
  const count = source.indexOf("printf 'container_count=%s\\n'");
  assert.ok(guard >= 0, 'Docker access guard is required');
  assert.ok(count > guard, 'container count must run only after the access guard');
  assert.match(source, /docker_daemon_access=false/);
  assert.match(source, /inventory_status=docker_access_denied_or_daemon_unavailable/);
  assert.doesNotMatch(source, /container_count=.*docker_access_denied/);
});

test('the inventory remains read-only, redacted, and telephony-free', () => {
  const source = inventory();
  assert.match(source, /environment_values_emitted=false/);
  assert.match(source, /fusionpbx_or_sip_contacted=false/);
  assert.doesNotMatch(source, /(?:curl|wget|ssh|rsync|scp|restic|pg_basebackup|pg_ctl|docker\s+compose\s+up|systemctl\s+(?:start|restart)|iptables|ufw)/);
  assert.doesNotMatch(source, /(?:printenv|env\s*$|\.env|cat\s+.*secret|POSTGRES_PASSWORD|JWT_SECRET)/m);
});
