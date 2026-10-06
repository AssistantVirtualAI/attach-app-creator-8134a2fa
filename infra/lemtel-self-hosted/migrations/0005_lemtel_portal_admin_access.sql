-- Lemtel portal administration extension — OFFLINE ONLY.
-- This package contains no imported Planiprêt data, no secrets, no temporary passwords,
-- no PBX mutations and no public configuration. Apply only with a separate target-write approval.
BEGIN;

ALTER TABLE public.lemtel_onboarding_audit
  DROP CONSTRAINT IF EXISTS lemtel_onboarding_audit_action_check;
ALTER TABLE public.lemtel_onboarding_audit
  ADD CONSTRAINT lemtel_onboarding_audit_action_check CHECK (
    action IN (
      'organization_created',
      'user_provisioned',
      'welcome_sent',
      'welcome_failed',
      'welcome_resent',
      'first_password_changed',
      'user_access_suspended'
    )
  );

CREATE INDEX IF NOT EXISTS lemtel_memberships_organization_status_idx
  ON public.lemtel_organization_memberships (organization_id, status, role, created_at);

COMMENT ON CONSTRAINT lemtel_onboarding_audit_action_check ON public.lemtel_onboarding_audit IS
  'Lemtel-only administrative audit action allow-list; it stores no temporary password, token, email body or PBX configuration.';

COMMIT;
