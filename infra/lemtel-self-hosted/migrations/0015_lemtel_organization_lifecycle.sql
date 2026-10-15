-- Lemtel organization lifecycle — source package only.
-- Adds only audited soft-archive/update vocabulary; no organization or user is changed by this migration.
BEGIN;
ALTER TABLE public.lemtel_onboarding_audit DROP CONSTRAINT IF EXISTS lemtel_onboarding_audit_action_check;
ALTER TABLE public.lemtel_onboarding_audit ADD CONSTRAINT lemtel_onboarding_audit_action_check CHECK (action IN (
  'organization_created','user_provisioned','welcome_sent','welcome_failed','welcome_resent','first_password_changed','temporary_password_rotated','user_access_suspended','domain_created','domain_suspended','domain_reactivated','membership_assigned','membership_reactivated','membership_role_changed','organization_ownership_transferred','client_session_access_revoked','client_session_access_reactivated','organization_updated','organization_archived'
));
COMMENT ON COLUMN public.lemtel_organizations.status IS 'Lemtel lifecycle: active or archived. Archive is a reversible, non-destructive access boundary.';
COMMIT;
