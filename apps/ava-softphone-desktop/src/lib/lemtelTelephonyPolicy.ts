/**
 * Read-only policy vocabulary used by Desktop UI components.
 * No policy is trusted from the client, and the current Hostinger bootstrap
 * deliberately exposes no telephony policy or credentials.
 */
export type RecordingPolicy = 'not_allowed' | 'user_allowed' | 'portal_managed';
export type BinaryPortalPolicy = 'enabled' | 'disabled';
