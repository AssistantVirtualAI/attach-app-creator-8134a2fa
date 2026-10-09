import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const scriptPath = resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-standby-docker-bootstrap.sh');
const source = readFileSync(scriptPath, 'utf8');

test('standby Docker bootstrap is root-only, role-locked, and image-locked', () => {
  assert.match(source, /^#!\/usr\/bin\/env bash/mu);
  assert.match(source, /require_root/u);
  assert.match(source, /digitalocean_standby/u);
  assert.match(source, /supabase\/postgres:17\.6\.1\.136/u);
  assert.match(source, /unapproved_postgres_image/u);
  assert.match(source, /existing_containers_refused/u);
});

test('standby Docker bootstrap prepares only a matching PostgreSQL image and inert directories', () => {
  assert.match(source, /apt-get install -y --no-install-recommends docker\.io docker-compose-v2 age/u);
  assert.match(source, /systemctl enable --now docker/u);
  assert.match(source, /docker pull/u);
  assert.match(source, /docker run --rm --entrypoint postgres/u);
  assert.match(source, /postgres_image_major=17/u);
  assert.match(source, /containers_started=false/u);
  assert.match(source, /standby_directories_prepared=true/u);
  assert.match(source, /age-keygen -o/u);
  assert.match(source, /standby_age_identity_root_readable_only=true/u);
});

test('standby Docker bootstrap does not create a data plane, secret channel, public listener, or telephony service', () => {
  assert.match(source, /public_database_listener_enabled=false/u);
  assert.match(source, /storage_replication_started=false/u);
  assert.match(source, /fusionpbx_or_sip_contacted=false/u);
  assert.match(source, /credential_values_emitted=false/u);
  assert.doesNotMatch(source, /(?:pg_basebackup|standby\.signal|primary_conninfo|\bpsql\b|CREATE\s+ROLE|ALTER\s+(?:ROLE|SYSTEM)|pg_promote|age\s+(?:-d|-r)|rsync|lsyncd|restic|docker\s+compose\s+up|--publish|-p\s*5432|ufw\s+(?:allow|deny|enable|disable)|iptables|nft\s+(?:add|delete|flush)|curl|wget|ssh|scp)/imu);
  assert.doesNotMatch(source, /(?:179\.236\.235\.108|192\.241\.137\.143|10\.253\.47\.)/u);
});
