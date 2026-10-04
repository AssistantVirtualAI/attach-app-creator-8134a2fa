// Phase 31E — read-only network diagnostic. NOT a deploy, DNS change or failover.
// Its custom /health/lemtel/ready contract does not exist until the dedicated
// stack is installed and independently verified. A parked page is never ready.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BlockList, isIP } from 'node:net';
import { resolve4, resolve6 } from 'node:dns/promises';
import { request } from 'node:https';
import { evaluate } from './lemtel-hosting-preflight.mjs';

export const DOMAIN = 'lemtel.avastatistic.ca';
export const HEALTH_PATH = '/health/lemtel/ready';
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const RESERVED = new BlockList();
for (const [base, mask] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10],
  ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) RESERVED.addSubnet(base, mask, 'ipv4');
export const publicIpv4 = (ip) => isIP(ip || '') === 4 && !RESERVED.check(ip, 'ipv4');
const TLS_ERRORS = new Set([
  'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
]);
const errorOutcome = (error) => TLS_ERRORS.has(error?.code) || String(error?.code || '').startsWith('ERR_TLS')
  ? 'tls_invalid' : error?.code === 'ETIMEDOUT' ? 'timeout' : 'connection_failed';

export const pinnedIpv4Lookup = (ip) => (_host, options, cb) => options.all
  ? cb(null, [{ address: ip, family: 4 }])
  : cb(null, ip, 4);

// Use the domain as Host/SNI, but connect to each IP independently. A valid
// certificate on the primary is not proof that the standby can serve traffic.
export function probeOrigin(domain, ip, timeoutMs = 3500) {
  return new Promise((resolveProbe) => {
    let settled = false;
    const done = (result) => { if (!settled) { settled = true; resolveProbe(result); } };
    const req = request({ hostname: domain, port: 443, path: HEALTH_PATH,
      method: 'GET', servername: domain, rejectUnauthorized: true,
      agent: false, timeout: timeoutMs, headers: { accept: 'application/json' },
      lookup: pinnedIpv4Lookup(ip),
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > 8192) { req.destroy(); done({ outcome: 'response_too_large' }); }
      });
      res.on('end', () => done({ outcome: 'http_response', statusCode: res.statusCode,
        contentType: String(res.headers['content-type'] || ''), body }));
    });
    req.on('timeout', () => { const error = new Error('timeout'); error.code = 'ETIMEDOUT'; req.destroy(error); });
    req.on('error', (error) => done({ outcome: errorOutcome(error) }));
    req.end();
  });
}

function validReadiness(response) {
  if (response?.outcome !== 'http_response' || response.statusCode !== 200 ||
      !/^application\/json(?:\s*;|\s*$)/i.test(response.contentType)) return false;
  try {
    const json = JSON.parse(response.body);
    return json?.service === 'lemtel-api' && json?.status === 'ready' &&
      ['auth', 'database', 'storage', 'functions'].every((key) => json?.dependencies?.[key] === true);
  } catch { return false; }
}

export async function inspect({ primaryIp, standbyIp, admissionReasons,
  lookup4 = resolve4, lookup6 = resolve6, probe = probeOrigin } = {}) {
  const reasons = [...(admissionReasons?.length ? admissionReasons : ['POLICY_UNREADABLE'])];
  let a = [];
  let aaaa = [];
  let ipv6Verified = true;
  try { a = await lookup4(DOMAIN); } catch { reasons.push('dns_a_unavailable'); }
  try { aaaa = await lookup6(DOMAIN); }
  catch (error) {
    if (error?.code !== 'ENODATA') { ipv6Verified = false; reasons.push('dns_aaaa_unavailable'); }
  }
  const primaryDnsMatch = publicIpv4(primaryIp) && a.length === 1 && a[0] === primaryIp;
  if (!primaryDnsMatch) reasons.push('dns_primary_mismatch_or_missing');
  if (aaaa.length) reasons.push('dns_ipv6_not_verified');
  const readOrigin = async (ip, label) => {
    if (!publicIpv4(ip)) { reasons.push(`${label}_public_ip_missing`); return 'not_checked'; }
    let response;
    try { response = await probe(DOMAIN, ip); } catch (error) { response = { outcome: errorOutcome(error) }; }
    if (validReadiness(response)) return 'ready';
    const outcome = ['tls_invalid', 'timeout', 'connection_failed'].includes(response?.outcome)
      ? response.outcome : 'health_contract_failed';
    reasons.push(`${label}_${outcome}`);
    return outcome;
  };
  const primary = await readOrigin(primaryIp, 'hostinger_primary');
  const standby = await readOrigin(standbyIp, 'digitalocean_standby');
  return { domain: DOMAIN, status: 'blocked', dns_primary_match: primaryDnsMatch,
    dns_ipv6_present: aaaa.length > 0, dns_ipv6_verified: ipv6Verified, hostinger_primary: primary,
    digitalocean_standby: standby, reasons };
}

export async function run(args, env = process.env, deps = {}) {
  if (args.length !== 1 || args[0] !== '--report') {
    return { code: 2, stdout: 'USAGE: LEMTEL_PRIMARY_IPV4=<ip> LEMTEL_STANDBY_IPV4=<ip> node scripts/lemtel-hosting-readiness.mjs --report\n' };
  }
  let admissionReasons;
  try {
    const policy = JSON.parse(readFileSync(resolve(ROOT, 'schemas/lemtel-staging-admission/staging-admission-policy.json'), 'utf8'));
    admissionReasons = evaluate(policy);
  } catch { admissionReasons = ['POLICY_UNREADABLE']; }
  const result = await inspect({ primaryIp: env.LEMTEL_PRIMARY_IPV4,
    standbyIp: env.LEMTEL_STANDBY_IPV4, admissionReasons, ...deps });
  // Report intentionally omits the supplied addresses and response body.
  return { code: 78, stdout: `${JSON.stringify(result)}\n` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await run(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.exitCode = result.code;
}
