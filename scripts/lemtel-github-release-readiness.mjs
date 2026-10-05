// Phase 38B — validates an inactive GitHub release-preparation contract only.
// This module never calls GitHub, builds artifacts, reads secrets, or contacts a VPS.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const POLICY_PATH = 'infra/lemtel-delivery/github-release-readiness.json';

const POLICY_KEYS = ['policy_version', 'scope', 'source', 'artifact', 'environments', 'pipeline'];
const SOURCE_KEYS = ['accepted_branch', 'rejected_branches', 'pull_request_required', 'dedicated_lovable_project_required', 'current_lovable_project_eligible'];
const ARTIFACT_KEYS = ['build_once', 'immutable_identity', 'sbom_format', 'provenance_format', 'source_maps_private', 'standby_rebuild'];
const ENVIRONMENT_KEYS = ['name', 'required_secret_names', 'configured', 'protection_rules_verified', 'deployment_authorized', 'runtime_write_authorized', 'healthcheck_required'];
const PIPELINE_KEYS = ['workflow_enabled', 'artifact_generation_authorized', 'primary_validation_required', 'standby_artifact_sync_authorized', 'standby_validation_required', 'external_write_authorized'];
const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const includesExactly = (value, expected) => Array.isArray(value) && value.length === expected.length && expected.every((item) => value.includes(item));

export function validateGitHubReleaseReadiness(policy) {
  if (!exactKeys(policy, POLICY_KEYS) ||
      policy.policy_version !== 'lemtel_github_release_readiness_v1' ||
      policy.scope !== 'offline_github_release_preparation_only' ||
      !exactKeys(policy.source, SOURCE_KEYS) ||
      policy.source.accepted_branch !== 'lemtel/integration' ||
      !includesExactly(policy.source.rejected_branches, ['Planipret']) ||
      policy.source.pull_request_required !== true ||
      policy.source.dedicated_lovable_project_required !== true ||
      policy.source.current_lovable_project_eligible !== false ||
      !exactKeys(policy.artifact, ARTIFACT_KEYS) ||
      policy.artifact.build_once !== true ||
      !includesExactly(policy.artifact.immutable_identity, ['git_sha', 'artifact_sha256']) ||
      policy.artifact.sbom_format !== 'cyclonedx' ||
      policy.artifact.provenance_format !== 'slsa' ||
      policy.artifact.source_maps_private !== true ||
      policy.artifact.standby_rebuild !== false ||
      !Array.isArray(policy.environments) || policy.environments.length !== 2 ||
      !exactKeys(policy.pipeline, PIPELINE_KEYS) ||
      policy.pipeline.workflow_enabled !== false ||
      policy.pipeline.artifact_generation_authorized !== false ||
      policy.pipeline.primary_validation_required !== true ||
      policy.pipeline.standby_artifact_sync_authorized !== false ||
      policy.pipeline.standby_validation_required !== true ||
      policy.pipeline.external_write_authorized !== false) return false;

  const [primary, standby] = policy.environments;
  return exactKeys(primary, ENVIRONMENT_KEYS) &&
    primary.name === 'lemtel-hostinger-primary' &&
    includesExactly(primary.required_secret_names, ['LEMTEL_HOSTINGER_DEPLOY_KEY', 'LEMTEL_HOSTINGER_KNOWN_HOSTS']) &&
    primary.configured === false && primary.protection_rules_verified === false && primary.deployment_authorized === false && primary.runtime_write_authorized === false && primary.healthcheck_required === true &&
    exactKeys(standby, ENVIRONMENT_KEYS) &&
    standby.name === 'lemtel-digitalocean-standby' &&
    includesExactly(standby.required_secret_names, ['LEMTEL_DIGITALOCEAN_DEPLOY_KEY', 'LEMTEL_DIGITALOCEAN_KNOWN_HOSTS']) &&
    standby.configured === false && standby.protection_rules_verified === false && standby.deployment_authorized === false && standby.runtime_write_authorized === false && standby.healthcheck_required === true;
}

export function reviewGitHubReleaseReadiness(policy) {
  if (!validateGitHubReleaseReadiness(policy)) {
    return { status: 'github_release_readiness_invalid', authorization: false, reasons: ['GITHUB_RELEASE_READINESS_INVALID', 'MANUAL_REVIEW_REQUIRED'] };
  }
  return {
    status: 'github_release_readiness_blocked',
    authorization: false,
    artifact_generation_authorized: false,
    github_environment_configuration_authorized: false,
    hostinger_deployment_authorized: false,
    digitalocean_artifact_sync_authorized: false,
    digitalocean_runtime_write_authorized: false,
    reasons: [
      'DEDICATED_LOVABLE_LEMTEL_PROJECT_AND_BRANCH_REQUIRED',
      'PULL_REQUEST_AND_CI_GATE_REQUIRED',
      'GITHUB_ENVIRONMENT_PROTECTION_AND_SECRET_SETUP_REQUIRED',
      'SINGLE_ARTIFACT_SBOM_AND_PROVENANCE_REQUIRED',
      'PRIMARY_HEALTHCHECK_BEFORE_STANDBY_ARTIFACT_SYNC_REQUIRED',
      'EXPLICIT_EXTERNAL_WRITE_AUTHORIZATION_REQUIRED',
    ],
  };
}

export function run(root = ROOT, reader = readFileSync) {
  try {
    const policy = JSON.parse(reader(join(root, POLICY_PATH), 'utf8'));
    return { code: 78, stdout: `${JSON.stringify(reviewGitHubReleaseReadiness(policy))}\n` };
  } catch {
    return { code: 78, stdout: '{"status":"github_release_readiness_invalid","authorization":false,"reasons":["GITHUB_RELEASE_READINESS_UNREADABLE","MANUAL_REVIEW_REQUIRED"]}\n' };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = run();
  process.stdout.write(result.stdout);
  process.exitCode = result.code;
}
