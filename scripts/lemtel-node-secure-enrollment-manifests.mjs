// Explicit offline manifest generation only. No environment discovery, network or deployment.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const repo = resolve(import.meta.dirname, '..');
const root = 'infra/lemtel-resilience/node-secure-enrollment/';
const functions = 'infra/lemtel-self-hosted/functions/';
const migrations = 'infra/lemtel-self-hosted/migrations/';
const hash = (path) => ({ path, sha256: createHash('sha256').update(readFileSync(resolve(repo, path))).digest('hex') });
const write = (path, value) => writeFileSync(resolve(repo, path), JSON.stringify(value, null, 2) + '\n');
const gates = { deployment_authorized: false, activation_authorized: false, schema_apply_authorized: false, runtime_key_generation_authorized: false, remote_commands_authorized: false };
const common = [functions + '_shared/lemtelNodeEnrollment.ts', functions + '_shared/lemtelNodeEnrollmentBackend.ts'];
const slugs = ['lemtel-node-enrollment','lemtel-node-enrollment-admin','lemtel-node-status-signed-ingest'];
const excluded = ['planipret','avastatistic','pbx','provider_calls','remote_commands','promotion','dns','runtime_start','routing','failover','timer_enablement'];
for (const slug of slugs) write(functions + slug + '/manifest.json', {
  package_version: 'lemtel_node_secure_enrollment_v1', scope: 'offline_publication_only_source', ...gates,
  slug, verify_jwt: slug.endsWith('-admin'), authentication: slug.endsWith('-admin') ? 'auth_get_user_plus_active_platform_admin_in_edge_and_sql_transaction' : 'pinned_p256_possession_plus_explicit_platform_admin_approval_no_cloud_identity_claim',
  enabled_only_if: 'LEMTEL_NODE_ENROLLMENT_ENABLED=approved_publication_only', default_status: 503,
  browser_response: slug.endsWith('-admin') ? ['requestId','role','fingerprint','state','expiresAt'] : 'none_origin_and_sec_fetch_mode_denied',
  sources: [functions + slug + '/index.ts', ...common].map(hash),
  runtime_requirements: ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','LEMTEL_NODE_ENROLLMENT_ENABLED', ...(slug === 'lemtel-node-enrollment' ? ['LEMTEL_NODE_PUBLICATION_ENDPOINT','LEMTEL_NODE_PUBLICATION_SIGNING_PRIVATE_JWK'] : [])],
  secret_values_in_bundle: false, logs: 'none_no_body_key_ciphertext_proof_or_token_logging', dependency_review: 'supabase_js_2.117.2_top_level_pinned_transitive_lock_required_before_deployment',
  request_body_deadline_seconds: 2, body_limit_bytes: slug.endsWith('-admin') ? 768 : slug === 'lemtel-node-enrollment' ? 2048 : 1024,
  routes_registered: false, explicitly_excluded: excluded,
});
const schemaManifest = migrations + 'lemtel-node-secure-enrollment-manifest.json';
write(schemaManifest, { package_version: 'lemtel_node_secure_enrollment_schema_v1', scope: 'offline_schema_rpc_audit', ...gates,
  migration_sources: [migrations + '0021_lemtel_node_secure_enrollment.sql'].map(hash),
  edge_sources: [...common, ...slugs.flatMap((slug) => [functions + slug + '/index.ts', functions + slug + '/manifest.json'])].map(hash),
  dependencies: [migrations + '0020_lemtel_node_status_observations.sql'].map(hash),
  requires_existing_table: 'public.lemtel_platform_administrators', browser_table_or_rpc_permissions: false, service_direct_table_permissions: false,
});
write(root + 'deployment-manifest.json', { package_version: 'lemtel_node_secure_enrollment_source_package_v1', scope: 'lemtel_only_offline_publication_enrollment', ...gates,
  base_commit: '7daec6cde', pending_identity_is_unverified: true, public_fingerprint_is_not_provider_identity: true,
  shared_hmac_config_delivery: false, server_delivery_signature_required: true, local_platform_public_key_and_endpoint_pins_required: true,
  crypto: ['ECDSA_P256_SHA256_P1363','ECDH_P256','HKDF_SHA256','AES256_GCM_96bit_IV_128bit_tag','SHA256_descriptor_fingerprint'],
  sources: [root + 'README.md', root + 'lemtel-node-publication-agent.ts', root + 'lemtel-node-publication-key-init.mjs', root + 'lemtel-node-publication-key-init.py', root + 'lemtel-node-publication-key-init.sh', root + 'lemtel-node-publication-key-state-diagnostic.sh', root + 'lemtel-node-publication-public-attestation.py', root + 'lemtel-platform-signer-credential-init.py', root + 'lemtel-platform-signer-credential-init.sh', root + 'systemd/lemtel-node-publication-preflight.service', root + 'systemd/lemtel-node-publication-preflight.timer', 'docs/lemtel-ha/NODE_SECURE_ENROLLMENT_PROTOCOL.md', 'docs/lemtel-ha/PLATFORM_SIGNER_CREDENTIAL.md'].map(hash),
  migration_sources: [migrations + '0021_lemtel_node_secure_enrollment.sql', schemaManifest].map(hash),
  edge_sources: [...common, ...slugs.flatMap((slug) => [functions + slug + '/index.ts', functions + slug + '/manifest.json'])].map(hash),
  validation_sources: [functions + 'lemtel-node-enrollment/index.test.ts', 'scripts/lemtel-node-secure-enrollment-postgres.test.mjs','scripts/lemtel-node-secure-enrollment-contract.test.mjs','scripts/lemtel-node-secure-enrollment-manifests.mjs','scripts/lemtel-node-publication-key-init-package.mjs','scripts/lemtel-node-publication-key-init-package.test.mjs','scripts/lemtel-node-publication-key-state-diagnostic.test.mjs','scripts/lemtel-node-publication-public-attestation.test.mjs','scripts/lemtel-platform-signer-credential-package.mjs','scripts/lemtel-platform-signer-credential-package.test.mjs'].map(hash),
  dependencies: [migrations + '0020_lemtel_node_status_observations.sql', functions + 'lemtel-node-status-ingest/index.ts', functions + 'lemtel-onboarding-admin/index.ts'].map(hash),
  required_preconditions: ['separate_schema_edge_route_approval','legacy_hmac_route_disabled_before_signed_activation','node_out_of_band_authentication_and_full_fingerprint_pin','platform_signer_secret_binding_and_public_pin_provisioning','route_and_database_log_redaction_review','rate_limits_and_proxy_deadlines','reviewed_dependency_lock_and_offline_node_packaging','target_postgres_multiconnection_rbac_concurrency_test','root_only_transport_not_provided','separate_local_installation_activation_and_rollback_approval'],
  explicitly_excluded: excluded,
});
console.log('node_secure_enrollment_manifests=generated_offline');
