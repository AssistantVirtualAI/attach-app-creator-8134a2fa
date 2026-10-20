import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { signingConfig, signCommand } = require('./azure-artifact-sign.cjs');

const ENV = { LEMTEL_AZURE_SIGNING: 'true', LEMTEL_AZURE_SIGNING_ENDPOINT: 'https://eus.codesigning.azure.net/', LEMTEL_AZURE_SIGNING_ACCOUNT: 'lemtelsigning', LEMTEL_AZURE_SIGNING_PROFILE: 'lemtel-desktop' };

test('unsigned builds stay unsigned unless Azure signing is explicitly enabled', () => {
  assert.equal(signingConfig({}), null);
  assert.equal(signingConfig({ ...ENV, LEMTEL_AZURE_SIGNING: 'false' }), null);
});

test('only well-formed Azure Artifact Signing coordinates are accepted', () => {
  assert.deepEqual(signingConfig(ENV), { endpoint: 'https://eus.codesigning.azure.net', account: 'lemtelsigning', profile: 'lemtel-desktop' });
  assert.throws(() => signingConfig({ ...ENV, LEMTEL_AZURE_SIGNING_ENDPOINT: 'https://evil.example.com' }), /endpoint/);
  assert.throws(() => signingConfig({ ...ENV, LEMTEL_AZURE_SIGNING_ACCOUNT: "x'; Remove-Item" }), /account/);
  assert.throws(() => signingConfig({ ...ENV, LEMTEL_AZURE_SIGNING_PROFILE: '' }), /profile/);
});

test('the signing command timestamps with SHA-256 and only uses the GitHub OIDC (Azure CLI) session', () => {
  const cmd = signCommand(signingConfig(ENV), "C:\\a\\Lemtel Telecom's Setup.exe");
  assert.match(cmd, /^Invoke-TrustedSigning -Endpoint 'https:\/\/eus\.codesigning\.azure\.net' -CodeSigningAccountName 'lemtelsigning' -CertificateProfileName 'lemtel-desktop'/);
  assert.match(cmd, /Telecom''s Setup\.exe'/, 'file path is PowerShell-quoted');
  assert.match(cmd, /-FileDigest SHA256 -TimestampRfc3161 'http:\/\/timestamp\.acs\.microsoft\.com' -TimestampDigest SHA256/);
  assert.match(cmd, /-ExcludeEnvironmentCredential/);
  assert.doesNotMatch(cmd, /-ExcludeAzureCliCredential/);
});
