import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-primary-canonical-caddy-apply.sh'), 'utf8');

test('canonical Caddy application is root-only, candidate-bound, locked, and rollback-capable', () => {
  assert.match(source, /^#!\/usr\/bin\/env bash/mu);
  assert.match(source, /apply_private_primary_canonical_caddy_route/u);
  assert.match(source, /LEMTEL_HA_ROLE:-\}" = 'hostinger_primary'/u);
  assert.match(source, /canonical_host='lemtel\.assistantvirtualai\.com'/u);
  assert.match(source, /flock -n 9 \|\| fail concurrent_canonical_caddy_apply/u);
  assert.match(source, /cmp -s "\$expected" "\$candidate" \|\| fail candidate_no_longer_matches_live_caddyfile/u);
  assert.match(source, /docker exec -i "\$caddy_container" caddy adapt --config \/dev\/stdin --adapter caddyfile/u);
  assert.match(source, /docker exec "\$caddy_container" caddy validate --config \/etc\/caddy\/Caddyfile --adapter caddyfile/u);
  assert.match(source, /docker exec "\$caddy_container" caddy reload --config \/etc\/caddy\/Caddyfile --adapter caddyfile/u);
  assert.match(source, /rollback\(\)/u);
  assert.match(source, /cp -- "\$backup" "\$caddyfile"/u);
  assert.match(source, /rollback_available=true/u);
  assert.match(source, /dns_change_executed=false/u);
  assert.match(source, /client_cutover_executed=false/u);
  assert.match(source, /automatic_promotion_enabled=false/u);
  assert.match(source, /fusionpbx_or_sip_contacted=false/u);
  assert.match(source, /credential_values_emitted=false/u);
  assert.doesNotMatch(source, /(?:cloudflare|\b(?:curl|wget|ssh|scp|rsync|restic|nsupdate|pg_promote)\b|docker\s+compose\s+up|\bturn\b|\bwss\b)/imu);
});
