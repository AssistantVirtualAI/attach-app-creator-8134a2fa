import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'infra/lemtel-resilience/active-passive/lemtel-ha-primary-canonical-caddy-prepare.sh'), 'utf8');

test('canonical Caddy preparation is root-only, fixed-host, and stages a candidate without a live reload', () => {
  assert.match(source, /^#!\/usr\/bin\/env bash/mu);
  assert.match(source, /prepare_private_primary_canonical_caddy_route/u);
  assert.match(source, /LEMTEL_HA_ROLE:-\}" = 'hostinger_primary'/u);
  assert.match(source, /canonical_host='lemtel\.assistantvirtualai\.com'/u);
  assert.match(source, /\{\$PROXY_DOMAIN\}, " canonical_host " \{"/u);
  assert.match(source, /docker exec -i "\$caddy_container" caddy adapt --config \/dev\/stdin --adapter caddyfile/u);
  assert.match(source, /existing_proxy_domain_preserved=true/u);
  assert.match(source, /live_caddyfile_replaced=false/u);
  assert.match(source, /caddy_reloaded=false/u);
  assert.match(source, /dns_change_executed=false/u);
  assert.match(source, /runtime_restarted=false/u);
  assert.match(source, /fusionpbx_or_sip_contacted=false/u);
  assert.match(source, /credential_values_emitted=false/u);
  assert.doesNotMatch(source, /(?:caddy\s+reload|docker\s+(?:compose\s+up|restart)|\b(?:curl|wget|ssh|scp|rsync|restic|nsupdate)\b|cloudflare|pg_promote|\bturn\b|\bwss\b)/imu);
});
