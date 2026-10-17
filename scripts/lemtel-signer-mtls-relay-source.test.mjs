import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const relayPath = resolve(root, 'infra/lemtel-resilience/cloudflare-platform-signer/lemtel-signer-mtls-relay.py');
const unitPath = resolve(root, 'infra/lemtel-resilience/cloudflare-platform-signer/systemd/lemtel-signer-mtls-relay.service');
const contractPath = resolve(root, 'infra/lemtel-resilience/cloudflare-platform-signer/mtls-relay-contract.json');
const relay = readFileSync(relayPath, 'utf8');
const unit = readFileSync(unitPath, 'utf8');
const contract = JSON.parse(readFileSync(contractPath, 'utf8'));

const python = (script) => execFileSync('python3', ['-I', '-c', script], { cwd: root, encoding: 'utf8' });

const delivery = JSON.stringify({
  sealed: { challenge: 'a'.repeat(64), ephemeralKey: 'b'.repeat(87), iv: 'c'.repeat(16), ciphertext: 'd'.repeat(64) },
  signature: 'e'.repeat(86),
});
const request = JSON.stringify({
  purpose: 'node_enrollment_publication_delivery',
  requestId: '11111111-1111-4111-8111-111111111111',
  sealed: { challenge: 'a'.repeat(64), ephemeralKey: 'b'.repeat(87), iv: 'c'.repeat(16), ciphertext: 'd'.repeat(64) },
});

test('source-only mTLS relay remains constrained to a single local protocol and fixed signer origin', () => {
  assert.match(relay, /SIGNER_HOST = "signer\.lemtel\.assistantvirtualai\.com"/);
  assert.match(relay, /SIGNER_PATH = "\/v1\/node-enrollment-delivery"/);
  assert.match(relay, /PURPOSE = "node_enrollment_publication_delivery"/);
  assert.match(relay, /socket\.AF_UNIX/);
  assert.match(relay, /socket\.SO_PEERCRED/);
  assert.match(relay, /connection\.request\("POST", SIGNER_PATH/);
  assert.doesNotMatch(relay, /requests\.|urllib|subprocess|os\.system|shell=True|curl|cloudflare|fencing|promotion|load_balancer|dns/i);
  assert.equal(contract.local_relay.local_peer_authorization_required, true);
  assert.equal(contract.local_relay.unauthorized_peer_denied_before_network, true);
  assert.equal(contract.local_relay.request_size_max_bytes, 4096);
  assert.equal(contract.local_relay.max_concurrent_requests, 1);
  assert.equal(contract.local_relay.rate_limit_max_requests, 3);
  assert.equal(contract.local_relay.uncertain_result_retry_forbidden, true);
  for (const value of Object.values(contract.activation)) assert.equal(value, false);
});

test('relay rejects wrong peer, unsafe payload, duplicate keys, and rate excess before any forwarder call', () => {
  const script = String.raw`
import importlib.util
import json
import sys
spec = importlib.util.spec_from_file_location("relay", ${JSON.stringify(relayPath)})
relay = importlib.util.module_from_spec(spec); sys.modules["relay"] = relay; spec.loader.exec_module(relay)
request = ${JSON.stringify(request)}.encode()
delivery = ${JSON.stringify(delivery)}.encode()
config = {"mode":"active", "peer_uid": 1234}
calls = []
def forwarder(*args):
    calls.append(args)
    return delivery
assert relay.dispatch(request, 1234, config, relay.RateLimiter(now=lambda: 10), forwarder, None) == delivery
assert len(calls) == 1
for raw, uid in [(request, 1235), (b'{"purpose":"node_enrollment_publication_delivery","purpose":"node_enrollment_publication_delivery"}', 1234), (b'x' * 4097, 1234)]:
    try: relay.dispatch(raw, uid, config, relay.RateLimiter(now=lambda: 10), forwarder, None)
    except relay.Deny: pass
    else: raise AssertionError("unsafe input accepted")
assert len(calls) == 1
limiter = relay.RateLimiter(now=lambda: 20)
for _ in range(3): relay.dispatch(request, 1234, config, limiter, forwarder, None)
try: relay.dispatch(request, 1234, config, limiter, forwarder, None)
except relay.Deny: pass
else: raise AssertionError("rate excess accepted")
assert len(calls) == 4
print("relay_dispatch_test=ok")
`;
  assert.equal(python(script).trim(), 'relay_dispatch_test=ok');
});

test('relay template is root-only, credential-gated, hardened and incapable of automatic installation', () => {
  assert.match(unit, /^User=root$/m);
  assert.match(unit, /^UMask=0077$/m);
  assert.match(unit, /^LoadCredentialEncrypted=client-cert\.pem:/m);
  assert.match(unit, /^LoadCredentialEncrypted=client-key\.pem:/m);
  assert.match(unit, /^ProtectSystem=strict$/m);
  assert.match(unit, /^PrivateDevices=yes$/m);
  assert.match(unit, /^RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6$/m);
  assert.match(unit, /^StandardOutput=null$/m);
  assert.doesNotMatch(unit, /^\[Install\]$/m);
  assert.doesNotMatch(unit, /EnvironmentFile=|Environment=.*(?:SECRET|TOKEN|KEY|CERTIFICATE)/i);
  assert.doesNotMatch(unit, /fencing|promotion|load.?balancer|cloudflare.?dns|telephony/i);
});

console.log('signer_mtls_relay_source_contract=ok');
