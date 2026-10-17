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

const rootPython = (script) => execFileSync('sudo', ['-n', 'python3', '-I', '-c', script], { cwd: root, encoding: 'utf8' });

test('source-only mTLS relay remains constrained to a single local protocol and fixed signer origin', () => {
  assert.match(relay, /SIGNER_HOST = "signer\.lemtel\.assistantvirtualai\.com"/);
  assert.match(relay, /SIGNER_PATH = "\/v1\/node-enrollment-delivery"/);
  assert.match(relay, /PURPOSE = "node_enrollment_publication_delivery"/);
  assert.match(relay, /socket\.AF_UNIX/); assert.match(relay, /socket\.SO_PEERCRED/);
  assert.match(relay, /connection\.request\("POST", SIGNER_PATH/); assert.match(relay, /UNAVAILABLE = b'\{"result":"unavailable"\}'/);
  assert.match(relay, /def _same_delivery\(/); assert.match(relay, /def _receive_framed\(/); assert.match(relay, /struct\.unpack\("!I"/); assert.match(relay, /def _safe_socket_parent\(path: Path, peer_uid: int\)/);
  assert.match(relay, /def _encrypted_credential_sources\(\)/); assert.match(relay, /_credential_paths\(os\.environ\.get\("CREDENTIALS_DIRECTORY"\)\)/);
  assert.doesNotMatch(relay, /requests\.|urllib|subprocess|os\.system|shell=True|curl|cloudflare|fencing|promotion|load_balancer|dns/i);
  assert.equal(contract.local_relay.local_peer_authorization_required, true);
  assert.equal(contract.local_relay.unauthorized_peer_denied_before_network, true);
  assert.equal(contract.local_relay.request_size_max_bytes, 6144);
  assert.equal(contract.local_relay.max_concurrent_requests, 1);
  assert.equal(contract.local_relay.rate_limit_max_requests, 3);
  assert.equal(contract.local_relay.accepted_role, 'do_writer');
  assert.equal(contract.local_relay.hostinger_standby_role_forbidden, true);
  assert.equal(contract.local_relay.expires_at_utc_validation_required, true);
  assert.equal(contract.local_relay.expires_at_minimum_leeway_seconds, 30);
  assert.equal(contract.local_relay.expires_at_max_ttl_seconds, 300);
  assert.equal(contract.local_relay.durable_replay_ledger_required, true);
  assert.equal(contract.local_relay.replay_ledger_survives_process_restart, true);
  assert.equal(contract.local_relay.replay_ledger_contains_secrets, false);
  assert.equal(contract.local_relay.uncertain_result_retry_forbidden, true);
  for (const value of Object.values(contract.activation)) assert.equal(value, false);
});

test('relay requires canonical input, role DO exact, expiration UTC bounded, and does not retry uncertain outcomes', () => {
  const script = String.raw`
import importlib.util, json, sys, uuid
spec = importlib.util.spec_from_file_location("relay", ${JSON.stringify(relayPath)})
relay = importlib.util.module_from_spec(spec); sys.modules["relay"] = relay; spec.loader.exec_module(relay)
config = {"mode":"active", "peer_uid": 1234}
calls = []
class MemoryLedger:
    def __init__(self): self.claims = []
    def claim(self, request_id, nonce, expires_at):
        if any(existing[0] == request_id or existing[1] == nonce for existing in self.claims): raise relay.Deny()
        self.claims.append((request_id, nonce, expires_at))
def fixture(role="do_writer", request_id=None, nonce=None, expires_at=None):
    request_id = request_id or str(uuid.uuid4())
    nonce = nonce or uuid.uuid4().hex + uuid.uuid4().hex
    expires_at = relay._utc_now_seconds() + relay.MINIMUM_EXPIRY_LEEWAY_SECONDS + 5 if expires_at is None else expires_at
    fingerprint = "sha256:" + "a" * 64
    sealed = {"challenge":{"requestId":request_id,"role":role,"fingerprint":fingerprint,"purpose":"claim","nonce":nonce,"expiresAt":expires_at},"ephemeralKey":"A" * 87,"iv":"B" * 16,"ciphertext":"C" * 43}
    request = {"purpose":"node_enrollment_publication_delivery","requestId":request_id,"role":role,"recipientFingerprint":fingerprint,"sealed":sealed,"authorization":"D" * 32}
    return relay.canonical_request(request), relay.canonical_request({"sealed":sealed,"signature":"E" * 86})
request, delivery = fixture(request_id="11111111-1111-4111-8111-111111111111", nonce="b" * 64)
def forwarder(*args):
    calls.append(args)
    return delivery
assert relay.dispatch(request, 1234, config, relay.RateLimiter(now=lambda: 10), forwarder, None, MemoryLedger()) == delivery
assert calls[-1][0] == relay.canonical_request(relay.parse_request(request))
reordered = request + b" "
try: relay.dispatch(reordered, 1234, config, relay.RateLimiter(now=lambda: 10), forwarder, None, MemoryLedger())
except relay.Deny: pass
else: raise AssertionError("noncanonical request accepted")
for raw, uid in [(request, 1235), (b'{"purpose":"node_enrollment_publication_delivery","purpose":"node_enrollment_publication_delivery"}', 1234), (b'x' * 6145, 1234)]:
    try: relay.dispatch(raw, uid, config, relay.RateLimiter(now=lambda: 10), forwarder, None, MemoryLedger())
    except relay.Deny: pass
    else: raise AssertionError("unsafe input accepted")
bad = json.loads(delivery); bad["sealed"]["challenge"]["requestId"] = "33333333-3333-4333-8333-333333333333"
try: relay.dispatch(request, 1234, config, relay.RateLimiter(now=lambda: 10), lambda *_: json.dumps(bad).encode(), None, MemoryLedger())
except relay.Deny: pass
else: raise AssertionError("mismatched response accepted")
limiter = relay.RateLimiter(now=lambda: 20)
for _ in range(3):
    current, delivery = fixture()
    relay.dispatch(current, 1234, config, limiter, forwarder, None, MemoryLedger())
current, delivery = fixture()
try: relay.dispatch(current, 1234, config, limiter, forwarder, None, MemoryLedger())
except relay.Deny: pass
else: raise AssertionError("rate excess accepted")
for expires_at in [relay._utc_now_seconds() - 1, relay._utc_now_seconds() + relay.MINIMUM_EXPIRY_LEEWAY_SECONDS, relay._utc_now_seconds() + relay.MAX_REQUEST_TTL_SECONDS + 1]:
    raw, _ = fixture(expires_at=expires_at)
    try: relay.parse_request(raw)
    except relay.Deny: pass
    else: raise AssertionError("expired or overlong TTL accepted")
hostinger, _ = fixture(role="hostinger_standby")
try: relay.dispatch(hostinger, 1234, config, relay.RateLimiter(now=lambda: 10), forwarder, None, MemoryLedger())
except relay.Deny: pass
else: raise AssertionError("Hostinger role accepted")
assert len(calls) == 4
print("relay_dispatch_test=ok")
`;
  assert.equal(python(script).trim(), 'relay_dispatch_test=ok');
});

test('durable root-only replay ledger rejects requestId and nonce reuse before network after reload', () => {
  const script = String.raw`
import importlib.util, json, os, shutil, sys, tempfile, uuid
from pathlib import Path
spec = importlib.util.spec_from_file_location("relay", ${JSON.stringify(relayPath)})
relay = importlib.util.module_from_spec(spec); sys.modules["relay"] = relay; spec.loader.exec_module(relay)
state = Path(tempfile.mkdtemp(prefix="lemtel-replay-ledger-"))
os.chown(state, 0, 0); os.chmod(state, 0o700)
try:
    path = state / "replay-ledger.json"
    now = relay._utc_now_seconds()
    expires_at = now + relay.MINIMUM_EXPIRY_LEEWAY_SECONDS + 5
    request_id = "11111111-1111-4111-8111-111111111111"
    nonce = "b" * 64
    fingerprint = "sha256:" + "a" * 64
    sealed = {"challenge":{"requestId":request_id,"role":"do_writer","fingerprint":fingerprint,"purpose":"claim","nonce":nonce,"expiresAt":expires_at},"ephemeralKey":"A" * 87,"iv":"B" * 16,"ciphertext":"C" * 43}
    request = relay.canonical_request({"purpose":"node_enrollment_publication_delivery","requestId":request_id,"role":"do_writer","recipientFingerprint":fingerprint,"sealed":sealed,"authorization":"D" * 32})
    delivery = relay.canonical_request({"sealed":sealed,"signature":"E" * 86})
    calls = []
    def forwarder(*args): calls.append(args); return delivery
    config = {"mode":"active", "peer_uid":1234}
    ledger = relay.ReplayLedger(str(path))
    assert relay.dispatch(request, 1234, config, relay.RateLimiter(now=lambda: 1), forwarder, None, ledger) == delivery
    assert len(calls) == 1
    try: relay.dispatch(request, 1234, config, relay.RateLimiter(now=lambda: 1), forwarder, None, ledger)
    except relay.Deny: pass
    else: raise AssertionError("same-process replay accepted")
    assert len(calls) == 1
    reloaded = relay.ReplayLedger(str(path))
    try: relay.dispatch(request, 1234, config, relay.RateLimiter(now=lambda: 1), forwarder, None, reloaded)
    except relay.Deny: pass
    else: raise AssertionError("reloaded replay accepted")
    assert len(calls) == 1
    try: reloaded.claim(str(uuid.uuid4()), nonce, expires_at)
    except relay.Deny: pass
    else: raise AssertionError("reloaded nonce replay accepted")
    try: reloaded.claim(request_id, uuid.uuid4().hex + uuid.uuid4().hex, expires_at)
    except relay.Deny: pass
    else: raise AssertionError("reloaded requestId replay accepted")
    metadata = path.stat()
    assert metadata.st_uid == 0 and metadata.st_gid == 0 and (metadata.st_mode & 0o777) == 0o600
    stored = json.loads(path.read_text(encoding="ascii"))
    assert set(stored) == {"version", "claims"} and set(stored["claims"][0]) == {"requestId", "nonce", "expiresAt"}
    assert "authorization" not in path.read_text(encoding="ascii") and "ciphertext" not in path.read_text(encoding="ascii")
finally:
    shutil.rmtree(state)
print("relay_durable_replay_ledger_test=ok")
`;
  assert.equal(rootPython(script).trim(), 'relay_durable_replay_ledger_test=ok');
});

test('relay refuses startup before configuration or socket creation when root-only mTLS credential metadata is absent', () => {
  const script = String.raw`
import importlib.util, sys
spec = importlib.util.spec_from_file_location("relay", ${JSON.stringify(relayPath)})
relay = importlib.util.module_from_spec(spec); sys.modules["relay"] = relay; spec.loader.exec_module(relay)
calls = []
relay.os.geteuid = lambda: 0
def missing_sources():
    calls.append("credential_sources")
    raise relay.Deny()
def unexpected_loaded_credentials(_):
    calls.append("loaded_credentials")
    raise AssertionError("loaded credentials checked after absent source")
def unexpected_config():
    calls.append("config")
    raise AssertionError("config read after absent source")
relay._encrypted_credential_sources = missing_sources
relay._credential_paths = unexpected_loaded_credentials
relay.load_config = unexpected_config
relay.socket.socket = lambda *_: (_ for _ in ()).throw(AssertionError("socket created after absent source"))
assert relay.run() == 78
assert calls == ["credential_sources"]
print("relay_startup_credential_gate=ok")
`;
  assert.equal(python(script).trim(), 'relay_startup_credential_gate=ok');
});

test('relay refuses startup before configuration or socket creation when loaded mTLS credentials are not root-only', () => {
  const script = String.raw`
import importlib.util, sys
spec = importlib.util.spec_from_file_location("relay", ${JSON.stringify(relayPath)})
relay = importlib.util.module_from_spec(spec); sys.modules["relay"] = relay; spec.loader.exec_module(relay)
calls = []
relay.os.geteuid = lambda: 0
def valid_sources():
    calls.append("credential_sources")
    return ()
def invalid_loaded_credentials(_):
    calls.append("loaded_credentials")
    raise relay.Deny()
def unexpected_config():
    calls.append("config")
    raise AssertionError("config read after invalid loaded credentials")
relay._encrypted_credential_sources = valid_sources
relay._credential_paths = invalid_loaded_credentials
relay.load_config = unexpected_config
relay.socket.socket = lambda *_: (_ for _ in ()).throw(AssertionError("socket created after invalid loaded credentials"))
assert relay.run() == 78
assert calls == ["credential_sources", "loaded_credentials"]
print("relay_loaded_credential_gate=ok")
`;
  assert.equal(python(script).trim(), 'relay_loaded_credential_gate=ok');
});

test('relay template is root-only, credential-gated, restart-safe and incapable of automatic installation', () => {
  assert.match(unit, /^User=root$/m); assert.match(unit, /^UMask=0077$/m);
  assert.match(unit, /^ConditionPathIsDirectory=\/etc\/lemtel-platform-signer\/credentials$/m);
  assert.match(unit, /^ConditionPathExists=\/etc\/lemtel-platform-signer\/credentials\/client-cert\.pem\.cred$/m);
  assert.match(unit, /^ConditionPathExists=\/etc\/lemtel-platform-signer\/credentials\/client-key\.pem\.cred$/m);
  assert.match(unit, /^LoadCredentialEncrypted=client-cert\.pem:/m); assert.match(unit, /^LoadCredentialEncrypted=client-key\.pem:/m);
  assert.match(unit, /^Restart=no$/m); assert.doesNotMatch(unit, /^Restart=(?!no$)/m);
  assert.match(unit, /^RuntimeDirectory=lemtel-platform-signer$/m); assert.match(unit, /^RuntimeDirectoryMode=0711$/m);
  assert.match(unit, /^StateDirectory=lemtel-platform-signer$/m); assert.match(unit, /^StateDirectoryMode=0700$/m);
  assert.match(unit, /^ReadWritePaths=\/run\/lemtel-platform-signer \/var\/lib\/lemtel-platform-signer$/m);
  assert.match(unit, /^ProtectSystem=strict$/m); assert.match(unit, /^PrivateDevices=yes$/m); assert.match(unit, /^RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6$/m);
  assert.match(unit, /^StandardOutput=null$/m); assert.doesNotMatch(unit, /^\[Install\]$/m);
  assert.doesNotMatch(unit, /EnvironmentFile=|Environment=.*(?:SECRET|TOKEN|KEY|CERTIFICATE)/i);
  assert.doesNotMatch(unit, /CAP_DAC_OVERRIDE|fencing|promotion|load.?balancer|cloudflare.?dns|telephony/i);
});
