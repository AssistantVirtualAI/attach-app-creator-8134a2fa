import fs from 'node:fs';

const contractPath = new URL('../infra/lemtel-client-cutover/device-test-readiness-contract.json', import.meta.url);
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));

export function validateDeviceTestReadiness(input = contract) {
  const fail = (reason) => ({ ok: false, reason });
  if (input.profile !== 'lemtel-active-passive') return fail('LEMTEL_ACTIVE_PASSIVE_PROFILE_REQUIRED');
  if (input.purpose !== 'controlled_authenticated_client_test_only') return fail('CONTROLLED_AUTHENTICATED_TEST_PURPOSE_REQUIRED');
  if (input.backend?.origin_must_be !== 'https://lemtel.assistantvirtualai.com') return fail('CANONICAL_LEMTEL_ORIGIN_REQUIRED');
  if (input.backend?.configuration_filter_required !== 'lemtel-hostinger-client-config-filter.mjs') return fail('LEMTEL_CONFIG_FILTER_REQUIRED');
  if (input.android?.artifact !== 'debug_apk' || input.android?.emulator_smoke_required !== true || input.android?.release_signing !== false || input.android?.public_distribution !== false) return fail('ANDROID_DEBUG_ONLY_REQUIRED');
  if (input.ios?.artifact !== 'testflight_internal_beta' || input.ios?.app_store_upload !== true || !Array.isArray(input.ios?.physical_installation_blocked_until) || input.ios.physical_installation_blocked_until.length < 2) return fail('IOS_TESTFLIGHT_GATE_REQUIRED');
  if (input.desktop_macos?.artifact !== 'unsigned_private_package' || input.desktop_macos?.auto_update !== false || input.desktop_macos?.public_distribution !== false) return fail('DESKTOP_PRIVATE_PACKAGE_ONLY');
  if (!Array.isArray(input.required_before_real_call_test) || input.required_before_real_call_test.length < 4) return fail('CALL_TEST_PREREQUISITES_REQUIRED');
  const forbidden = new Set(input.forbidden);
  for (const value of ['Planipret', 'Lovable_current_project', 'desktop_auto_update', 'FusionPBX_mutation', 'automatic_failover', 'public_postgres_listener', 'Hostinger_writer_restart']) {
    if (!forbidden.has(value)) return fail(`FORBIDDEN_BOUNDARY_MISSING_${value}`);
  }
  return { ok: true, profile: input.profile, purpose: input.purpose };
}

if (process.argv[1]?.endsWith('lemtel-device-test-readiness.mjs')) {
  const result = validateDeviceTestReadiness();
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = result.ok ? 0 : 78;
}
