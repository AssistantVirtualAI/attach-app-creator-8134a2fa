import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const scriptPath = resolve(root, 'infra/lemtel-resilience/traffic-observability/lemtel-ha-do-writer-traffic-runtime-preflight.sh');
const source = readFileSync(scriptPath, 'utf8');

test('traffic runtime preflight is root-only, writer-only, argument-free and fail-closed', () => {
  assert.match(source, /^#!\/usr\/bin\/env bash/mu);
  assert.match(source, /^set \+x$/mu);
  assert.match(source, /^set -euo pipefail$/mu);
  assert.match(source, /\[\[ "\$EUID" -eq 0 \]\] \|\| fail root_required/u);
  assert.match(source, /\[\[ "\$#" -eq 0 \]\] \|\| fail invalid_arguments/u);
  assert.match(source, /LEMTEL_HA_ROLE:-\}" = digitalocean_writer/u);
  assert.match(source, /trap 'fail preflight_refused' ERR/u);
  assert.match(source, /activation_preflight_ready=false/u);
  assert.match(source, /reason=runtime_not_ready/u);
});

test('traffic runtime preflight checks only redacted local runtime state required for transactional preparation', () => {
  const routeSyntax = source.replaceAll('\\/', '/');
  for (const token of [
    'supabase-caddy',
    'supabase-edge-functions',
    "# LEMTEL_TRAFFIC_INGRESS_V1",
    '@lemtel_traffic_ingest',
    '/functions/v1/lemtel-traffic-ingest',
    'log_skip',
    'com.docker.compose.project',
    'com.docker.compose.service',
    'com.docker.compose.project.config_files',
    'docker compose version',
    "lemtel-onboarding-admin/index.ts",
    "lemtel-traffic-ingest/index.ts",
    "lemtel-traffic-ingest/manifest.json",
    "lemtel-traffic-collector.timer",
    "lemtel-traffic-collector.service",
  ]) assert.ok(routeSyntax.includes(token), `missing ${token}`);
  assert.match(routeSyntax, /if grep -F -q -- '\/functions\/v1\/lemtel-traffic-ingest' "\$caddyfile".*?printf invalid/su);
  assert.match(source, /ingress_route" = absent \|\| "\$ingress_route" = ready/u);
  assert.match(source, /collector_config" = absent \|\| "\$collector_config" = safe/u);
  assert.match(source, /edge_traffic_ingest_source" = present/u);
  assert.match(source, /collector_timer" != active && "\$collector_service" != active/u);
  assert.match(source, /stat --format='%u:%a:%F'/u);
  assert.match(source, /\[\[ -L "\$collector_config" \]\]/u);
  assert.match(source, /file_type" = 'regular file'/u);
});

test('traffic runtime preflight contains no mutator, network client, SQL, container execution or compose-config call', () => {
  const forbidden = /\b(?:curl|wget|nc|socat|ssh|scp|rsync|psql|postgres|systemctl\s+(?:enable|disable|start|stop|restart|reload|daemon-reload)|docker\s+(?:exec|run|start|stop|restart)|docker\s+compose\s+(?:up|down|restart|start|stop|config)|caddy\s+reload|sqlcmd)\b/iu;
  assert.doesNotMatch(source, forbidden);
  assert.doesNotMatch(source, /(?:^|\n)\s*(?:source|eval|cat)\b/mu);
  assert.doesNotMatch(source, /\.Config\.Env|\.Config\.Cmd|\.Config\.Entrypoint/u);
  assert.doesNotMatch(source, /(?:^|\n)\s*(?:rm|mv|cp|install|touch|mkdir|tee)\b/mu);
  for (const line of source.split('\n').filter((line) => line.includes('docker inspect'))) {
    assert.match(line, /--format/u, `unreduced docker inspect: ${line}`);
  }
});

test('traffic runtime preflight output is key=value redacted state without secret, endpoint, IP or URL values', () => {
  for (const key of [
    'traffic_runtime_preflight_format',
    'writer',
    'read_only',
    'remote_contacted',
    'caddy_candidate_count',
    'caddy_candidate_unique',
    'caddy_running',
    'caddy_mount',
    'caddyfile',
    'ingress_route',
    'edge_candidate_count',
    'edge_candidate_unique',
    'edge_running',
    'edge_functions_mount',
    'edge_functions_source',
    'edge_admin_source',
    'edge_traffic_ingest_source',
    'compose_command',
    'collector_config',
    'collector_timer',
    'collector_service',
    'credential_values_emitted',
    'collector_activation_authorized',
    'activation_preflight_ready',
    'traffic_runtime_preflight_status',
    'reason',
  ]) assert.match(source, new RegExp(`printf '${key}=`), `missing output key ${key}`);
  assert.doesNotMatch(source, /LEMTEL_TRAFFIC_(?:COLLECTOR_SECRET|ENDPOINT)|https?:\/\/|\b(?:\d{1,3}\.){3}\d{1,3}\b/iu);
  assert.doesNotMatch(source, /printf[^\n]*(?:caddy_container|edge_container|caddy_mount_source|edge_functions_mount_source)/u);
  assert.doesNotMatch(source, /printf[^\n]*(?:\.env|\/etc\/|com\.docker\.compose)/u);
  assert.doesNotMatch(source, /(?:echo|printenv|env\s*$)/mu);
});

test('this test is static and never invokes the preflight runtime', () => {
  assert.doesNotMatch(source, /node --test/u);
  const precedingTestSource = readFileSync(new URL(import.meta.url), 'utf8').split("test('this test is static")[0];
  assert.ok(!/child_process|spawnSync|execFileSync|execSync/u.test(precedingTestSource));
});
