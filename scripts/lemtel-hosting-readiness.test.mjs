import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMAIN, HEALTH_PATH, inspect, pinnedIpv4Lookup, publicIpv4, run } from './lemtel-hosting-readiness.mjs';

// Only mocked probes use these well-known public resolver addresses.
const PRIMARY = '1.1.1.1';
const BACKUP = '8.8.8.8';
const ready = { outcome: 'http_response', statusCode: 200,
  contentType: 'application/json; charset=utf-8',
  body: JSON.stringify({ service: 'lemtel-api', status: 'ready',
    dependencies: { auth: true, database: true, storage: true, functions: true } }) };
const baseline = {
  primaryIp: PRIMARY, standbyIp: BACKUP, admissionReasons: ['ADMISSION_DENIED'],
  lookup4: async () => [PRIMARY], lookup6: async () => [],
  probe: async () => ready,
};

test('épingle les IPv4 pour les deux modes lookup Node 22', () => {
  const lookup = pinnedIpv4Lookup(PRIMARY);
  lookup(DOMAIN, { all: true }, (_error, addresses) => {
    assert.deepEqual(addresses, [{ address: PRIMARY, family: 4 }]);
  });
  lookup(DOMAIN, { all: false }, (_error, address, family) => {
    assert.equal(address, PRIMARY);
    assert.equal(family, 4);
  });
});

test('rejette les plages non publiques, même si un faux DNS et une fausse santé correspondent', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.2', '100.64.0.1', '169.254.0.1',
    '172.16.0.1', '192.168.1.2', '192.0.2.1', '198.51.100.1', '203.0.113.1', '224.0.0.1']) {
    assert.equal(publicIpv4(ip), false, ip);
  }
  assert.equal(publicIpv4(PRIMARY), true);
  let calls = 0;
  const result = await inspect({ ...baseline, primaryIp: '127.0.0.1', standbyIp: '10.0.0.2',
    lookup4: async () => ['127.0.0.1'], probe: async () => { calls++; return ready; } });
  assert.equal(result.dns_primary_match, false);
  assert.equal(result.hostinger_primary, 'not_checked');
  assert.equal(result.digitalocean_standby, 'not_checked');
  assert.equal(calls, 0);
});

test('la sonde cible un endpoint métier et non une page HTML de parking', async () => {
  assert.equal(DOMAIN, 'lemtel.avastatistic.ca');
  assert.equal(HEALTH_PATH, '/health/lemtel/ready');
  const result = await inspect({ ...baseline, probe: async (_domain, ip) => ip === PRIMARY
    ? { outcome: 'http_response', statusCode: 200, contentType: 'text/html', body: '<h1>IONOS</h1>' }
    : ready });
  assert.equal(result.status, 'blocked');
  assert.equal(result.hostinger_primary, 'health_contract_failed');
  assert.equal(result.digitalocean_standby, 'ready');
});

test('la permission de déployer ne découle jamais du seul DNS et de deux réponses HTTPS', async () => {
  const result = await inspect(baseline);
  assert.equal(result.dns_primary_match, true);
  assert.equal(result.hostinger_primary, 'ready');
  assert.equal(result.digitalocean_standby, 'ready');
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.reasons, ['ADMISSION_DENIED']);
});

test('refuse un A incorrect, un AAAA non vérifié ou un certificat échoué sur le secours', async () => {
  const result = await inspect({ ...baseline, lookup4: async () => [BACKUP],
    lookup6: async () => ['2001:db8::1'],
    probe: async (_domain, ip) => ip === BACKUP ? { outcome: 'tls_invalid' } : ready });
  assert.equal(result.dns_primary_match, false);
  assert.deepEqual(result.reasons.slice(1), [
    'dns_primary_mismatch_or_missing', 'dns_ipv6_not_verified', 'digitalocean_standby_tls_invalid',
  ]);
});

test('ENODATA accepte l’absence AAAA; un timeout DNS bloque au lieu de la cacher', async () => {
  const absent = await inspect({ ...baseline, lookup6: async () => { throw Object.assign(new Error('no AAAA'), { code: 'ENODATA' }); } });
  assert.equal(absent.dns_ipv6_verified, true);
  assert.ok(!absent.reasons.includes('dns_aaaa_unavailable'));
  const timeout = await inspect({ ...baseline, lookup6: async () => { throw Object.assign(new Error('DNS timeout'), { code: 'ETIMEOUT' }); } });
  assert.equal(timeout.dns_ipv6_verified, false);
  assert.ok(timeout.reasons.includes('dns_aaaa_unavailable'));
});

test('sépare les erreurs de connexion, de délai et de certificat', async () => {
  for (const [code, expected] of [
    ['ECONNREFUSED', 'connection_failed'], ['ETIMEDOUT', 'timeout'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls_invalid'],
  ]) {
    const result = await inspect({ ...baseline, probe: async () => { throw Object.assign(new Error('probe failed'), { code }); } });
    assert.equal(result.hostinger_primary, expected);
    assert.ok(result.reasons.includes(`hostinger_primary_${expected}`));
  }
});

test('refuse un faux marqueur JSON ou la base indisponible', async () => {
  const result = await inspect({ ...baseline, probe: async () => ({ ...ready,
    body: JSON.stringify({ service: 'lemtel-api', status: 'ready',
      dependencies: { auth: true, database: false, storage: true, functions: true } }) }) });
  assert.equal(result.hostinger_primary, 'health_contract_failed');
  assert.equal(result.digitalocean_standby, 'health_contract_failed');
});

test('ne contacte pas un serveur sans IPv4 valide et ne divulgue aucune adresse en mode rapport', async () => {
  let calls = 0;
  const deps = { lookup4: async () => [PRIMARY], lookup6: async () => [],
    probe: async () => { calls++; return ready; } };
  const result = await run(['--report'], { LEMTEL_PRIMARY_IPV4: PRIMARY,
    LEMTEL_STANDBY_IPV4: '' }, deps);
  assert.equal(result.code, 78);
  assert.equal(JSON.parse(result.stdout).digitalocean_standby, 'not_checked');
  assert.ok(!result.stdout.includes(PRIMARY));
  assert.ok(!result.stdout.includes(BACKUP));
  assert.equal(calls, 1);
});
