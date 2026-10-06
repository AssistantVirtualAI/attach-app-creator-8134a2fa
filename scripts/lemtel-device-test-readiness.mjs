import fs from 'node:fs';

const contractPath = new URL('../infra/lemtel-client-cutover/device-test-readiness-contract.json', import.meta.url);
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));

export function validateDeviceTestReadiness(input = contract) {
  const fail = (reason) => ({ ok: false, reason });
  if (input.profile !== 'hostinger-staging') return fail('HOSTINGER_STAGING_PROFILE_REQUIRED');
  if (input.purpose !== 'private_device_test_only') return fail('PRIVATE_TEST_PURPOSE_REQUIRED');
  if (input.backend?.origin_must_be !== 'https://lemtel.avastatistic.ca') return fail('HOSTINGER_ORIGIN_REQUIRED');
  if (input.backend?.configuration_filter_required !== 'lemtel-hostinger-client-config-filter.mjs') return fail('HOSTINGER_FILTER_REQUIRED');
  if (input.android?.artifact !== 'debug_apk' || input.android?.emulator_smoke_required !== true || input.android?.release_signing !== false) return fail('ANDROID_DEBUG_ONLY_REQUIRED');
  if (input.ios?.artifact !== 'unsigned_device_compile' || input.ios?.app_store_upload !== false || !Array.isArray(input.ios?.physical_installation_blocked_until) || input.ios.physical_installation_blocked_until.length < 3) return fail('IOS_SIGNING_GATE_REQUIRED');
  if (input.desktop_macos?.artifact !== 'unsigned_private_package' || input.desktop_macos?.auto_update !== false || input.desktop_macos?.public_distribution !== false) return fail('DESKTOP_PRIVATE_PACKAGE_ONLY');
  if (!Array.isArray(input.required_before_real_call_test) || input.required_before_real_call_test.length < 4) return fail('CALL_TEST_PREREQUISITES_REQUIRED');
  const forbidden = new Set(input.forbidden);
  for (const value of ['Planipret', 'Lovable_current_project', 'production_release', 'release_signing', 'app_store_or_play_store_upload', 'desktop_auto_update', 'FusionPBX_mutation', 'DNS_change', 'DigitalOcean_standby_start']) {
    if (!forbidden.has(value)) return fail(`FORBIDDEN_BOUNDARY_MISSING_${value}`);
  }
  return { ok: true, profile: input.profile, purpose: input.purpose };
}

if (process.argv[1]?.endsWith('lemtel-device-test-readiness.mjs')) {
  const result = validateDeviceTestReadiness();
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = result.ok ? 0 : 78;
}
