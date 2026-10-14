-- Lemtel membership governance — source package only. Apply only through an approved writer deployment.
-- Completes the existing organization membership lifecycle. It does not create accounts,
-- modify DNS, contact a PBX/provider, or expose data to direct browser access.
BEGIN;

ALTER TABLE public.lemtel_onboarding_audit
  DROP CONSTRAINT IF EXISTS lemtel_onboarding_audit_action_check;
ALTER TABLE public.lemtel_onboarding_audit
  ADD CONSTRAINT lemtel_onboarding_audit_action_check CHECK (action IN (
    'organization_created',
    'user_provisioned',
    'welcome_sent',
    'welcome_failed',
    'welcome_resent',
    'first_password_changed',
    'temporary_password_rotated',
    'user_access_suspended',
    'domain_created',
    'domain_suspended',
    'domain_reactivated',
    'membership_assigned',
    'membership_reactivated',
    'membership_role_changed'
  ));

COMMENT ON TABLE public.lemtel_organization_memberships IS
  'Lemtel-only organization membership authority. Role and status changes are server-authorized and increment the account-authority revision.';

COMMIT;
