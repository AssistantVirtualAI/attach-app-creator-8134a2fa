const FORMAT = 'lemtel_mtls_client_lifecycle_record_v2';
const COMMON_NAME = 'lemtel-do-signer-mtls-relay';
const STATES = new Set(['issued', 'active', 'superseded', 'revoked', 'expired']);
const FINGERPRINT = /^sha256:[a-f0-9]{64}$/u;
const SERIAL = /^[a-f0-9]{32,64}$/u;
const REVOCATION_REASONS = new Set(['compromise', 'operator_revoke', 'issuer_revoke']);
export const MAXIMUM_LEAF_LIFETIME_SECONDS = 86400;
export const MAXIMUM_ROTATION_OVERLAP_SECONDS = 300;

const RECORD_KEYS = ['format', 'state', 'generation', 'commonName', 'trustAnchorFingerprint', 'intermediateFingerprint', 'leafFingerprint', 'serial', 'notBefore', 'notAfter', 'overlapStartedAt', 'overlapUntil', 'reason'];
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
const sameIdentity = (left, right) => left.generation === right.generation && left.commonName === right.commonName && left.trustAnchorFingerprint === right.trustAnchorFingerprint && left.intermediateFingerprint === right.intermediateFingerprint && left.leafFingerprint === right.leafFingerprint && left.serial === right.serial && left.notBefore === right.notBefore && left.notAfter === right.notAfter;

function validFingerprints(value) {
  const fingerprints = [value.trustAnchorFingerprint, value.intermediateFingerprint, value.leafFingerprint];
  return fingerprints.every((fingerprint) => FINGERPRINT.test(fingerprint)) && new Set(fingerprints).size === fingerprints.length;
}

function validLiveRecordShape(value, now) {
  return exact(value, RECORD_KEYS)
    && value.format === FORMAT
    && ['issued', 'active'].includes(value.state)
    && Number.isSafeInteger(value.generation)
    && value.generation >= 1
    && value.commonName === COMMON_NAME
    && validFingerprints(value)
    && SERIAL.test(value.serial)
    && Number.isSafeInteger(value.notBefore)
    && Number.isSafeInteger(value.notAfter)
    && value.notBefore <= now
    && value.notAfter > now + 30
    && value.notAfter > value.notBefore
    && value.notAfter - value.notBefore <= MAXIMUM_LEAF_LIFETIME_SECONDS
    && value.overlapStartedAt === null
    && value.overlapUntil === null
    && value.reason === null;
}

export function validateMtlsLifecycleRecord(value, now) {
  if (!Number.isSafeInteger(now) || !exact(value, RECORD_KEYS) || value.format !== FORMAT || !STATES.has(value.state) || !Number.isSafeInteger(value.generation) || value.generation < 1 || value.commonName !== COMMON_NAME || !validFingerprints(value) || !SERIAL.test(value.serial) || !Number.isSafeInteger(value.notBefore) || !Number.isSafeInteger(value.notAfter) || value.notAfter <= value.notBefore || value.notAfter - value.notBefore > MAXIMUM_LEAF_LIFETIME_SECONDS) return false;
  if (value.state === 'issued' || value.state === 'active') return validLiveRecordShape(value, now);
  if (value.state === 'superseded') return value.notBefore <= now && Number.isSafeInteger(value.overlapStartedAt) && Number.isSafeInteger(value.overlapUntil) && value.overlapStartedAt >= value.notBefore && value.overlapUntil >= value.overlapStartedAt && value.overlapUntil - value.overlapStartedAt <= MAXIMUM_ROTATION_OVERLAP_SECONDS && value.overlapUntil <= value.notAfter && value.overlapUntil <= now && value.reason === 'rotation';
  if (value.state === 'revoked') return value.notBefore <= now && value.overlapStartedAt === null && value.overlapUntil === null && REVOCATION_REASONS.has(value.reason);
  return value.notBefore <= now && value.overlapStartedAt === null && value.overlapUntil === null && value.reason === 'certificate_expired' && value.notAfter <= now;
}

function validExpiryPredecessor(value, now) {
  return exact(value, RECORD_KEYS)
    && value.format === FORMAT
    && ['issued', 'active'].includes(value.state)
    && Number.isSafeInteger(value.generation)
    && value.generation >= 1
    && value.commonName === COMMON_NAME
    && validFingerprints(value)
    && SERIAL.test(value.serial)
    && Number.isSafeInteger(value.notBefore)
    && Number.isSafeInteger(value.notAfter)
    && value.notBefore <= now
    && value.notAfter <= now
    && value.notAfter > value.notBefore
    && value.notAfter - value.notBefore <= MAXIMUM_LEAF_LIFETIME_SECONDS
    && value.overlapStartedAt === null
    && value.overlapUntil === null
    && value.reason === null;
}

const blocked = (reason) => Object.freeze({ status: 'manual_review_required', reason, structurallyValid: false, evidenceVerified: false, transitionAuthorized: false, relayActivationAllowed: false, accessPolicyActivationAllowed: false, automaticFailoverAllowed: false });
const evidencePending = (transition) => Object.freeze({ status: 'external_evidence_required', transition, structurallyValid: true, evidenceVerified: false, transitionAuthorized: false, relayActivationAllowed: false, accessPolicyActivationAllowed: false, automaticFailoverAllowed: false });

export function evaluateMtlsLifecycleTransition({ current = null, next, successor = null, now } = {}) {
  if (!Number.isSafeInteger(now) || !validateMtlsLifecycleRecord(next, now)) return blocked('invalid_next_record');
  if (current !== null && !validateMtlsLifecycleRecord(current, now) && !(next.state === 'expired' && validExpiryPredecessor(current, now))) return blocked('invalid_current_record');
  if (successor !== null && !validateMtlsLifecycleRecord(successor, now)) return blocked('invalid_successor_record');
  if (current === null) return next.state === 'issued' && next.generation === 1 ? evidencePending('issue') : blocked('issuance_must_start_at_generation_one');
  if (current.state === 'revoked' || current.state === 'expired' || current.state === 'superseded') return blocked('terminal_state_cannot_reactivate');
  if (next.generation !== current.generation || !sameIdentity(current, next)) return blocked('identity_or_generation_mismatch');
  if (current.state === 'issued' && next.state === 'active') return evidencePending('activate');
  if ((current.state === 'issued' || current.state === 'active') && next.state === 'revoked') return evidencePending('revoke');
  if ((current.state === 'issued' || current.state === 'active') && next.state === 'expired' && next.notAfter <= now) return evidencePending('expire');
  if (current.state === 'active' && next.state === 'superseded') {
    if (successor === null || successor.state !== 'active' || successor.generation !== current.generation + 1 || successor.commonName !== current.commonName || successor.trustAnchorFingerprint !== current.trustAnchorFingerprint || successor.intermediateFingerprint === current.intermediateFingerprint || successor.leafFingerprint === current.leafFingerprint || successor.serial === current.serial || successor.notBefore > next.overlapStartedAt || successor.notAfter <= now + 30) return blocked('invalid_rotation_successor');
    return evidencePending('rotate');
  }
  return blocked('transition_not_allowed');
}

export const MTLS_CLIENT_LIFECYCLE = Object.freeze({ FORMAT, COMMON_NAME });
