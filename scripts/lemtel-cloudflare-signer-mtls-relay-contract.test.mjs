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
    socket_owner_mode_and_mount_boundary_test_required: true,
    fixed_signer_origin_required: true,
    fixed_purpose_required: 'node_enrollment_publication_delivery',
    arbitrary_url_or_method_forbidden: true,
    arbitrary_signing_oracle_forbidden: true,
    outbound_network_before_local_authorization_forbidden: true,
    request_size_max_bytes: 4096,
    max_concurrent_requests: 1,
    rate_limit_window_seconds: 60,
    rate_limit_max_requests: 3,
    local_timeout_seconds_max: 3,
    outbound_timeout_seconds_max: 5,
    uncertain_result_retry_forbidden: true,
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
    '4096 octets',
    'trois requêtes',
    'sans retry implicite',
    'node_enrollment_publication_delivery',
    'fencing',
    'bascule',
    'https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/mutual-tls-authentication/',
  ]) assert.ok(model.includes(required), required);
  assert.doesNotMatch(model, /(?:dop_v1_|github_pat_|ghp_|AKIA|-----BEGIN [A-Z ]*PRIVATE KEY)/u);
});
