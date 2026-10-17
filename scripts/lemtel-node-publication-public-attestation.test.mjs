import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const path = resolve(root, 'infra/lemtel-resilience/node-secure-enrollment/lemtel-node-publication-public-attestation.py');
const source = readFileSync(path, 'utf8');

test('public attestation is root-gated, redacted, read-only and fail-closed', () => {
  for (const expected of [
    "CONFIG = '/etc/lemtel-node-publication'",
    "STATE = '/var/lib/lemtel-node-publication'",
    "KEYS = CONFIG + '/keys.json'",
    "LEMTEL_NODE_PUBLIC_ATTEST_APPROVAL') != 'attest_public_descriptor_only'",
    "{'do_writer', 'hostinger_standby'}",
    "private_key_material_output=false",
    "private_key_proof=false",
    "filesystem_mutation=false",
    "network_access=false",
    "automatic_failover_enabled=false",
    "node_publication_public_attestation_status=complete",
  ]) assert.ok(source.includes(expected), expected);
  for (const forbidden of ['urllib', 'requests', 'socket', 'http.client', 'subprocess', 'os.system', 'shell=True', 'systemctl', 'docker', 'ssh', 'pg_promote', 'open(\'', "open(\""]) assert.ok(!source.includes(forbidden), forbidden);
  assert.match(source, /os\.O_RDONLY \| os\.O_NOFOLLOW/u);
  assert.match(source, /after\.st_dev != before\.st_dev/u);
  assert.match(source, /after\.st_ino != before\.st_ino/u);
});

test('public attestation accepts only distinct SEC1 P-256 public descriptors', () => {
  const publicA = `BA${'A'.repeat(85)}`;
  const publicB = `BA${'B'.repeat(85)}`;
  const code = [
    'import importlib.util,json,sys',
    'sys.dont_write_bytecode=True',
    's=importlib.util.spec_from_file_location("a",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)',
    `value={'descriptor':{'signingKey':'${publicA}','encryptionKey':'${publicB}'},'signingPrivate':{},'encryptionPrivate':{}}`,
    'print(m.fingerprint(value))',
  ].join(';');
  const output = execFileSync('python3', ['-I', '-c', code, path], { encoding: 'utf8' }).trim();
  assert.match(output, /^sha256:[a-f0-9]{64}$/);
});

test('public attestation source never prints or serializes private key values', () => {
  assert.doesNotMatch(source, /print\([^\n]*(?:signingPrivate|encryptionPrivate)\)/u);
  assert.doesNotMatch(source, /(?:^|\n)\s*json\.dump\(/u);
  assert.doesNotMatch(source, /(?:sys\.stdout\.write|os\.write)\(/u);
  assert.match(source, /print\('public_fingerprint=' \+ result\)/u);
});
