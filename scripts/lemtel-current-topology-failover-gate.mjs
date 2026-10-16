// Pure in-memory gate for the current Lemtel HA topology. It performs no I/O.

const CONTRACT_KEYS = [
  'contract_version',
  'scope',
  'current_topology',
  'cloudflare',
  'fail_closed_gates',
  'activation',
  'boundaries',
  'prepared_execution_agent',
];
const TOPOLOGY_KEYS = ['writer', 'standby', 'postgresql', 'storage_integrity', 'hostinger_runtime'];
const POSTGRESQL_KEYS = ['replication', 'standby_state', 'public_listener'];
const STORAGE_KEYS = ['required', 'dual_durable_write_acknowledgement', 'immutable_runtime_artifact_staged'];
const RUNTIME_KEYS = ['encrypted_staged', 'running'];
const PREPARED_EXECUTION_AGENT_KEYS = [
  'hostinger_promotion_script_prepared',
  'hostinger_runtime_start_script_prepared',
  'default_mode',
  'service_installed',
  'timer_enabled',
  'execute_mode_configured',
  'routing_owned_by_cloudflare_load_balancer',
];
const CLOUDFLARE_KEYS = [
  'monitor_present',
  'do_pool_present',
  'hostinger_pool_present',
  'load_balancer_present',
  'routing_configured',
  'load_balancer_priority_when_authorized',
  'monitor_never_promotes',
];
const GATE_KEYS = [
  'do_writer_provider_fence_attestation',
  'hostinger_promotion_drill',
  'cloudflare_load_balancer_and_routing',
  'reverse_failback_drill',
  'mobile_retry_validation',
  'single_writer_evidence',
];
const ACTIVATION_KEYS = [
  'automatic_provider_fencing',
  'automatic_promotion',
  'automatic_runtime_start',
  'automatic_traffic_routing',
  'automatic_failback',
];
const BOUNDARY_KEYS = [
  'single_writer_only',
  'public_postgres_listener',
  'provider_api_contact',
  'planipret_change',
  'avastatistic_change',
  'fusionpbx_or_telephony_change',
  'legacy_inverse_role_scripts_automate_current_topology',
];

export const REQUIRED_EVIDENCE_KEYS = [
  'incident_id',
  'do_writer_provider_fence_attestation',
  'hostinger_standby_recovery_streaming',
  'storage_integrity',
  'hostinger_runtime_staged',
  'hostinger_runtime_stopped',
  'no_public_postgres',
  'single_writer_evidence',
  'provider_fence_drill',
  'promotion_drill',
  'cloudflare_lb_routing',
  'reverse_failback_drill',
  'mobile_retry',
  'manual_authorization',
];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => isObject(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const allBooleans = (value) => Object.values(value).every((entry) => typeof entry === 'boolean');
const isIncidentId = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{7,79}$/u.test(value);

export function validateCurrentTopologyContract(contract) {
  return exactKeys(contract, CONTRACT_KEYS) &&
    contract.contract_version === 'lemtel_current_ha_topology_v2' &&
    contract.scope === 'prepared_current_topology_execution_agent_uninstalled' &&
    exactKeys(contract.current_topology, TOPOLOGY_KEYS) &&
    contract.current_topology.writer === 'do_writer' &&
    contract.current_topology.standby === 'hostinger_private_hot_standby' &&
    exactKeys(contract.current_topology.postgresql, POSTGRESQL_KEYS) &&
    contract.current_topology.postgresql.replication === 'synchronous' &&
    contract.current_topology.postgresql.standby_state === 'recovery_streaming' &&
    contract.current_topology.postgresql.public_listener === false &&
    exactKeys(contract.current_topology.storage_integrity, STORAGE_KEYS) &&
    contract.current_topology.storage_integrity.required === true &&
    contract.current_topology.storage_integrity.dual_durable_write_acknowledgement === true &&
    contract.current_topology.storage_integrity.immutable_runtime_artifact_staged === true &&
    exactKeys(contract.current_topology.hostinger_runtime, RUNTIME_KEYS) &&
    contract.current_topology.hostinger_runtime.encrypted_staged === true &&
    contract.current_topology.hostinger_runtime.running === false &&
    exactKeys(contract.cloudflare, CLOUDFLARE_KEYS) &&
    contract.cloudflare.monitor_present === true &&
    contract.cloudflare.do_pool_present === true &&
    contract.cloudflare.hostinger_pool_present === true &&
    contract.cloudflare.load_balancer_present === false &&
    contract.cloudflare.routing_configured === false &&
    Array.isArray(contract.cloudflare.load_balancer_priority_when_authorized) &&
    JSON.stringify(contract.cloudflare.load_balancer_priority_when_authorized) ===
      JSON.stringify(['do_writer', 'hostinger_private_hot_standby']) &&
    contract.cloudflare.monitor_never_promotes === true &&
    exactKeys(contract.fail_closed_gates, GATE_KEYS) && allBooleans(contract.fail_closed_gates) &&
    Object.values(contract.fail_closed_gates).every((entry) => entry === false) &&
    exactKeys(contract.activation, ACTIVATION_KEYS) && allBooleans(contract.activation) &&
    Object.values(contract.activation).every((entry) => entry === false) &&
    exactKeys(contract.boundaries, BOUNDARY_KEYS) &&
    contract.boundaries.single_writer_only === true &&
    contract.boundaries.public_postgres_listener === false &&
    contract.boundaries.provider_api_contact === false &&
    contract.boundaries.planipret_change === false &&
    contract.boundaries.avastatistic_change === false &&
    contract.boundaries.fusionpbx_or_telephony_change === false &&
    contract.boundaries.legacy_inverse_role_scripts_automate_current_topology === false &&
    exactKeys(contract.prepared_execution_agent, PREPARED_EXECUTION_AGENT_KEYS) &&
    contract.prepared_execution_agent.hostinger_promotion_script_prepared === true &&
    contract.prepared_execution_agent.hostinger_runtime_start_script_prepared === true &&
    contract.prepared_execution_agent.default_mode === 'review' &&
    contract.prepared_execution_agent.service_installed === false &&
    contract.prepared_execution_agent.timer_enabled === false &&
    contract.prepared_execution_agent.execute_mode_configured === false &&
    contract.prepared_execution_agent.routing_owned_by_cloudflare_load_balancer === true;
}

export function validateInMemoryEvidence(evidence) {
  return exactKeys(evidence, REQUIRED_EVIDENCE_KEYS) &&
    isIncidentId(evidence.incident_id) &&
    REQUIRED_EVIDENCE_KEYS.slice(1).every((key) => evidence[key] === true);
}

function missingEvidenceReasons(evidence = {}) {
  const present = (key) => evidence?.[key] === true;
  return [
    !(present('do_writer_provider_fence_attestation') && present('provider_fence_drill')) && 'provider_fence_drill',
    !(present('hostinger_standby_recovery_streaming') && present('promotion_drill')) && 'promotion_drill',
    !present('storage_integrity') && 'storage_integrity',
    !(present('hostinger_runtime_staged') && present('hostinger_runtime_stopped')) && 'hostinger_runtime_staged',
    !present('no_public_postgres') && 'no_public_postgres',
    !present('single_writer_evidence') && 'single_writer_evidence',
    !present('cloudflare_lb_routing') && 'cloudflare_lb_routing',
    !present('reverse_failback_drill') && 'reverse_failback',
    !present('mobile_retry') && 'mobile_retry',
    !present('manual_authorization') && 'manual_authorization',
  ].filter(Boolean);
}

export function evaluateCurrentTopologyFailoverGate(contract, evidence) {
  const contractValid = validateCurrentTopologyContract(contract);
  const evidenceValid = validateInMemoryEvidence(evidence);
  const reasons = [
    !contractValid && 'current_topology_contract_invalid',
    ...missingEvidenceReasons(evidence),
    !evidenceValid && 'in_memory_evidence_incomplete_or_invalid',
  ].filter(Boolean);

  if (reasons.length > 0) {
    return {
      status: 'automatic_failover_blocked',
      automatic_failover_enabled: false,
      automatic_promotion_enabled: false,
      automatic_traffic_routing_enabled: false,
      automatic_failback_enabled: false,
      reasons: [...new Set(reasons)],
    };
  }

  return {
    status: 'manual_failover_readiness_evidence_complete',
    automatic_failover_enabled: false,
    automatic_promotion_enabled: false,
    automatic_traffic_routing_enabled: false,
    automatic_failback_enabled: false,
    manual_action_required: true,
    reasons: [],
  };
}

export function run(input = {}) {
  const safeInput = isObject(input) ? input : {};
  const report = evaluateCurrentTopologyFailoverGate(safeInput.contract, safeInput.evidence);
  return {
    code: report.status === 'manual_failover_readiness_evidence_complete' ? 0 : 78,
    stdout: `${JSON.stringify(report)}\n`,
  };
}
