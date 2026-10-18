import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const issuerSource = readFileSync(resolve(root, 'infra/lemtel-resilience/cloudflare-platform-signer/lemtel-ha-do-writer-managed-mtls-leaf-candidate-issuer.sh'), 'utf8');

function openssl(args, directory) {
  const result = spawnSync('openssl', args, { cwd: directory, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: directory } });
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stderr}`);
  return result.stdout;
}

test('isolated OpenSSL drill validates the root, per-generation intermediary and client-auth leaf profile', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lemtel-mtls-candidate-crypto-'));
  try {
    const rootKey = join(directory, 'root-key.pem');
    const rootCert = join(directory, 'root-cert.pem');
    const intermediateKey = join(directory, 'intermediate-key.pem');
    const intermediateCsr = join(directory, 'intermediate.csr');
    const intermediateCert = join(directory, 'intermediate-cert.pem');
    const leafKey = join(directory, 'leaf-key.pem');
    const leafCsr = join(directory, 'leaf.csr');
    const leafCert = join(directory, 'leaf-cert.pem');
    const intermediateExtensions = join(directory, 'intermediate.cnf');
    const leafExtensions = join(directory, 'leaf.cnf');

    openssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', rootKey], directory);
    openssl(['req', '-new', '-x509', '-key', rootKey, '-sha256', '-days', '2', '-subj', '/CN=isolated-lemtel-root', '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:1', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-out', rootCert], directory);
    openssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', intermediateKey], directory);
    openssl(['req', '-new', '-key', intermediateKey, '-subj', '/CN=isolated-lemtel-intermediate', '-out', intermediateCsr], directory);
    writeFileSync(intermediateExtensions, '[intermediate]\nbasicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n', { mode: 0o600 });
    openssl(['x509', '-req', '-in', intermediateCsr, '-CA', rootCert, '-CAkey', rootKey, '-CAcreateserial', '-sha256', '-days', '1', '-extfile', intermediateExtensions, '-extensions', 'intermediate', '-out', intermediateCert], directory);
    openssl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', leafKey], directory);
    openssl(['req', '-new', '-key', leafKey, '-subj', '/CN=lemtel-do-signer-mtls-relay', '-out', leafCsr], directory);
    writeFileSync(leafExtensions, '[leaf]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=clientAuth\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n', { mode: 0o600 });
    openssl(['x509', '-req', '-in', leafCsr, '-CA', intermediateCert, '-CAkey', intermediateKey, '-CAcreateserial', '-sha256', '-days', '1', '-extfile', leafExtensions, '-extensions', 'leaf', '-out', leafCert], directory);

    const verification = openssl(['verify', '-CAfile', rootCert, '-untrusted', intermediateCert, leafCert], directory);
    assert.match(verification, /leaf-cert\.pem: OK/u);
    const intermediateText = openssl(['x509', '-in', intermediateCert, '-noout', '-text'], directory);
    const leafText = openssl(['x509', '-in', leafCert, '-noout', '-text'], directory);
    assert.match(intermediateText, /CA:TRUE, pathlen:0/u);
    assert.match(intermediateText, /Certificate Sign/u);
    assert.match(leafText, /CA:FALSE/u);
    assert.match(leafText, /Digital Signature/u);
    assert.match(leafText, /TLS Web Client Authentication/u);
    const certificateDigest = openssl(['x509', '-in', rootCert, '-pubkey', '-noout'], directory);
    const keyDigest = openssl(['pkey', '-in', rootKey, '-pubout'], directory);
    assert.equal(certificateDigest, keyDigest);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('candidate issuer source keeps the validated profile and stays compiled disabled', () => {
  for (const value of [
    "readonly CANDIDATE_ISSUANCE_AUTHORIZED='false'",
    'basicConstraints=critical,CA:TRUE,pathlen:0',
    'keyUsage=critical,keyCertSign,cRLSign',
    'basicConstraints=critical,CA:FALSE',
    'keyUsage=critical,digitalSignature',
    'extendedKeyUsage=clientAuth',
    'cat "$TEMPORARY_DIRECTORY/leaf-cert.pem" "$TEMPORARY_DIRECTORY/intermediate-cert.pem"',
    'systemd-creds encrypt --with-key=host',
  ]) assert.ok(issuerSource.includes(value), value);
  assert.doesNotMatch(issuerSource, /(?:-----BEGIN|PRIVATE KEY|certificate_content|\/etc\/lemtel-platform-signer\/credentials\/client-(?:cert|key)\.pem\.cred)/u);
});
