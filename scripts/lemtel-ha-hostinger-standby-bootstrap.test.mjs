import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const path = resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-hostinger-standby-bootstrap.sh');
const source = readFileSync(path, 'utf8');

test('Hostinger standby bootstrap is root-only, token-gated, clean-host-only, and role-locked', () => {
  assert.match(source, /^#!\/usr\/bin\/env bash/mu);
  assert.match(source, /require_root/u);
  assert.match(source, /bootstrap_clean_hostinger_private_standby/u);
  assert.match(source, /hostinger_standby/u);
  assert.match(source, /existing_containers_refused/u);
  assert.match(source, /supabase\/postgres:17\.6\.1\.136/u);
});

test('Hostinger standby bootstrap creates only local protected preparation state', () => {
  assert.match(source, /apt-get install -y --no-install-recommends age rsync wireguard-tools/u);
  assert.match(source, /age-keygen -o/u);
  assert.match(source, /wg genkey/u);
  assert.match(source, /docker pull/u);
  assert.match(source, /standby_age_identity_root_readable_only=true/u);
  assert.match(source, /wireguard_interface_started=false/u);
  assert.match(source, /postgres_listener_5432_started=false/u);
  assert.match(source, /runtime_started=false/u);
});

test('Hostinger standby bootstrap cannot start a data plane, route traffic, or touch telephony', () => {
  assert.match(source, /public_database_listener_enabled=false/u);
  assert.match(source, /automatic_promotion_enabled=false/u);
  assert.match(source, /dns_failover_enabled=false/u);
  assert.match(source, /fusionpbx_or_sip_contacted=false/u);
  assert.doesNotMatch(source, /(?:pg_basebackup|pg_promote|\bpsql\b|docker\s+compose\s+up|docker\s+run\s+-d|--publish|-p\s*5432|wg-quick|systemctl\s+enable\s+--now\s+wg|ufw\s+(?:allow|deny|enable|disable)|cloudflare|\bnsupdate\b|https?:\/\/)/imu);
});

test('Hostinger standby bootstrap has no embedded private key, address, or token', () => {
  assert.doesNotMatch(source, /BEGIN (?:OPENSSH|PRIVATE) KEY/u);
  assert.doesNotMatch(source, /(?:10\.253\.47\.|72\.60\.125\.253|179\.236\.235\.108)/u);
  assert.doesNotMatch(source, /(?:DIGITALOCEAN_TOKEN|HOSTINGER_API_TOKEN|Authorization: Bearer)/u);
});
