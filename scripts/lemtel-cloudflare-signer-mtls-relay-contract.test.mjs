import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const contractPath = resolve(root, 'infra/lemtel-resilience/cloudflare-platform-signer/mtls-relay-contract.json');
const modelPath = resolve(root, 'docs/lemtel-ha/CLOUDFLARE_SIGNER_MTLS_RELAY_THREAT_MODEL.md');
const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
const model = readFileSync(modelPath, 'utf8');

test('mTLS relay remains a source-only, non-deployable identity alternative', () => {
  assert.equal(contract.status, 'design_review_required_not_deployable');
  assert.equal(contract.contract_version, 'lemtel_cloudflare_platform_signer_mtls_relay_v7');
  assert.equal(contract.implementation.source_available, true);
  assert.equal(contract.implementation.source_only, true);
  assert.equal(contract.implementation.production_deployment_authorized, false);
  assert.equal(contract.implementation.network_listener_type, 'unix_socket_only');
  assert.equal(contract.implementation.fixed_signer_hostname, 'signer.lemtel.assistantvirtualai.com');
  assert.equal(contract.implementation.fixed_signer_path, '/v1/node-enrollment-delivery');
  assert.equal(contract.implementation.root_only_systemd_template_without_install_section, true);
  assert.equal(contract.identity.mechanism, 'cloudflare_access_mutual_tls_service_auth');
  assert.equal(contract.identity.dedicated_client_identity_required, true);
  assert.equal(contract.identity.reuse_node_or_platform_key_forbidden, true);
  assert.equal(contract.identity.source_ip_authentication_forbidden, true);
  assert.equal(contract.identity.access_policy_action, 'service_auth');
  assert.equal(contract.identity.access_policy_selector, 'common_name_exact');
  assert.equal(contract.identity.access_application_default_deny, true);
  assert.equal(contract.identity.access_user_policy_allowed, false);
  assert.equal(contract.certificate_lifecycle.contract_file, 'mtls-client-lifecycle-contract.json');
  assert.equal(contract.certificate_lifecycle.current_access_root_ca_imported_out_of_band, true);
  assert.equal(contract.certificate_lifecycle.current_access_root_ca_associated_hostname, 'signer.lemtel.assistantvirtualai.com');
  assert.equal(contract.certificate_lifecycle.current_access_root_ca_der_fingerprint_reconciliation_complete, false);
  assert.equal(contract.certificate_lifecycle.bootstrap_leaf_for_active_relay_forbidden, true);
  assert.equal(contract.certificate_lifecycle.service_auth_policy_count, 0);
  assert.equal(contract.certificate_lifecycle.relay_activation_allowed, false);
  for (const [key, value] of Object.entries(contract.activation)) assert.equal(value, false, key);
});

test('mTLS relay excludes direct Edge secrets, network listeners, arbitrary signing and all HA activation', () => {
  for (const [key, expected] of Object.entries({
    root_only_service_required: true,
    edge_container_direct_certificate_access_forbidden: true,
    unix_socket_only_required: true,
    container_network_listener_forbidden: true,
    local_peer_authorization_required: true,
    unauthorized_peer_denied_before_network: true,
    accepted_role: 'do_writer',
    hostinger_standby_role_forbidden: true,
    socket_owner_mode_and_mount_boundary_test_required: true,
    fixed_signer_origin_required: true,
    fixed_purpose_required: 'node_enrollment_publication_delivery',
    arbitrary_url_or_method_forbidden: true,
    arbitrary_signing_oracle_forbidden: true,
    outbound_network_before_local_authorization_forbidden: true,
    request_size_max_bytes: 6144,
    max_concurrent_requests: 1,
    rate_limit_window_seconds: 60,
    rate_limit_max_requests: 3,
    local_timeout_seconds_max: 3,
    outbound_timeout_seconds_max: 5,
    expires_at_utc_validation_required: true,
    expires_at_minimum_leeway_seconds: 30,
    expires_at_max_ttl_seconds: 300,
    durable_replay_ledger_required: true,
    replay_ledger_rejects_request_id_and_nonce_reuse_before_network: true,
    replay_ledger_survives_process_restart: true,
    replay_ledger_contains_secrets: false,
    replay_ledger_directory: '/var/lib/lemtel-platform-signer',
    replay_ledger_directory_mode: '0700',
    replay_ledger_file: '/var/lib/lemtel-platform-signer/replay-ledger.json',
    replay_ledger_file_mode: '0600',
    systemd_runtime_directory: 'lemtel-platform-signer',
    systemd_runtime_directory_mode: '0711',
    systemd_state_directory: 'lemtel-platform-signer',
    systemd_state_directory_mode: '0700',
    systemd_restart: 'no',
    uncertain_result_retry_forbidden: true,
    unambiguous_local_unavailable_result: true,
    response_request_binding_required: true,
    stale_socket_verified_cleanup_required: true,
    service_installed: false,
    service_enabled: false,
    socket_created: false,
    client_certificate_generated: false,
    client_private_key_stored: false,
  })) assert.equal(contract.local_relay[key], expected, key);
  for (const key of ['planipret', 'avastatistic', 'pbx', 'telephony', 'cloudflare_load_balancer', 'cloudflare_dns', 'provider_api_calls', 'fencing', 'promotion', 'hostinger_runtime_start', 'automatic_failover']) assert.ok(contract.explicitly_excluded.includes(key), key);
});

test('mTLS relay model retains explicit external-review and safety gates', () => {
  for (const required of [
    'source-only, non déployable',
    'indépendante',
    'root-only',
    'socket Unix',
    'identité locale du pair',
    '6144 octets',
    'trois requêtes',
    'sans retry implicite',
    'node_enrollment_publication_delivery',
    'fencing',
    'bascule',
    'https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/mutual-tls-authentication/',
  ]) assert.ok(model.includes(required), required);
  assert.doesNotMatch(model, /(?:dop_v1_|github_pat_|ghp_|AKIA|-----BEGIN [A-Z ]*PRIVATE KEY)/u);
});
