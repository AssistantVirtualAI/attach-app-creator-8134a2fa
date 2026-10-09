import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const primaryPath = resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-primary-replication-inventory.sh');
const standbyPath = resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-standby-preflight.sh');
const blockedMutation = /\b(?:apt(?:-get)?|dnf|yum|useradd|usermod|passwd|curl|wget|scp|rsync|restic|iptables|nft\s+(?:add|delete|flush)|ufw\s+(?:allow|deny|enable|disable)|systemctl\s+(?:start|restart|reload|enable|disable)|docker\s+(?:run|start|restart)|docker\s+compose\s+up)\b|(?:^|\n)\s*ssh\s+/mu;

for (const [label, path] of [['primary', primaryPath], ['standby', standbyPath]]) {
  test(`${label} preflight stays root-only, redacted, and non-mutating`, () => {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /^#!\/usr\/bin\/env bash/mu);
    assert.match(source, /require_root/u);
    assert.match(source, /fusionpbx_or_sip_contacted=false/u);
    assert.match(source, /credential_values_emitted=false/u);
    assert.doesNotMatch(source, blockedMutation);
  });
}

test('primary inventory only reads PostgreSQL replication posture and storage class', () => {
  const source = readFileSync(primaryPath, 'utf8');
  assert.match(source, /postgres_wal_level/u);
  assert.match(source, /postgres_max_wal_senders/u);
  assert.match(source, /postgres_max_replication_slots/u);
  assert.match(source, /postgres_replication_slot_count/u);
  assert.match(source, /storage_backend_class/u);
  assert.doesNotMatch(source, /pg_basebackup|CREATE ROLE|ALTER SYSTEM|ALTER ROLE|SELECT\s+pg_promote/u);
});

test('standby preflight makes no runtime or listener change', () => {
  const source = readFileSync(standbyPath, 'utf8');
  assert.match(source, /postgres_listener_5432_present/u);
  assert.match(source, /wireguard_listener_51820_present/u);
  assert.doesNotMatch(source, /standby\.signal|primary_conninfo|docker pull|docker load/u);
});
