// electron-builder Windows sign hook — Azure Artifact Signing (formerly Trusted Signing).
// Called by electron-builder for every Windows binary it produces (app exe, uninstaller, NSIS installer), BEFORE
// latest.yml hashes are computed, so auto-update metadata always matches the signed files.
// No secret anywhere: the release workflow signs in to Azure with GitHub OIDC (azure/login); Invoke-TrustedSigning
// then uses that Azure CLI session. When LEMTEL_AZURE_SIGNING is not "true" the hook signs nothing (unsigned build).
'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ENDPOINT_RE = /^https:\/\/[a-z0-9]{2,8}\.codesigning\.azure\.net\/?$/;
const NAME_RE = /^[A-Za-z][A-Za-z0-9-]{2,99}$/;
const psQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;

function signingConfig(env = process.env) {
  if (env.LEMTEL_AZURE_SIGNING !== 'true') return null;
  const endpoint = env.LEMTEL_AZURE_SIGNING_ENDPOINT || '';
  const account = env.LEMTEL_AZURE_SIGNING_ACCOUNT || '';
  const profile = env.LEMTEL_AZURE_SIGNING_PROFILE || '';
  if (!ENDPOINT_RE.test(endpoint)) throw new Error('azure_signing_endpoint_invalid');
  if (!NAME_RE.test(account) || account.length > 24) throw new Error('azure_signing_account_invalid');
  if (!NAME_RE.test(profile)) throw new Error('azure_signing_profile_invalid');
  return { endpoint: endpoint.replace(/\/$/, ''), account, profile };
}

function signCommand(config, file) {
  return [
    'Invoke-TrustedSigning',
    '-Endpoint', psQuote(config.endpoint),
    '-CodeSigningAccountName', psQuote(config.account),
    '-CertificateProfileName', psQuote(config.profile),
    '-Files', psQuote(path.resolve(file)),
    '-FileDigest', 'SHA256',
    '-TimestampRfc3161', psQuote('http://timestamp.acs.microsoft.com'),
    '-TimestampDigest', 'SHA256',
    // Only the GitHub OIDC session (Azure CLI) may sign: no environment secret, no managed identity probing.
    '-ExcludeEnvironmentCredential', '-ExcludeWorkloadIdentityCredential', '-ExcludeManagedIdentityCredential',
    '-ExcludeSharedTokenCacheCredential', '-ExcludeVisualStudioCredential', '-ExcludeVisualStudioCodeCredential',
    '-ExcludeAzurePowerShellCredential', '-ExcludeAzureDeveloperCliCredential', '-ExcludeInteractiveBrowserCredential',
  ].join(' ');
}

async function sign(configuration) {
  const config = signingConfig();
  if (!config) return;
  const command = signCommand(config, configuration.path);
  execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'; ${command}`], { stdio: 'inherit' });
}

module.exports = sign;
module.exports.default = sign;
module.exports.signingConfig = signingConfig;
module.exports.signCommand = signCommand;
