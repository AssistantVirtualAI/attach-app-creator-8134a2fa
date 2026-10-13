-- Lemtel portal account authority — OFFLINE ONLY; requires a separate target-write approval.
-- Creates Lemtel-only revision metadata. It never creates Auth users, sends email,
-- stores a password, changes shared data, or contacts PBX/telephony infrastructure.
BEGIN;

ALTER TABLE public.lemtel_organizations
  ADD COLUMN IF NOT EXISTS account_authority_revision bigint NOT NULL DEFAULT 1;

ALTER TABLE public.lemtel_organizations
  DROP CONSTRAINT IF EXISTS lemtel_organizations_account_authority_revision_check;
ALTER TABLE public.lemtel_organizations
  ADD CONSTRAINT lemtel_organizations_account_authority_revision_check
  CHECK (account_authority_revision > 0);

-- Server-only monotonic revision used by clients to detect organization/access changes.
CREATE OR REPLACE FUNCTION public.lemtel_bump_account_authority_revision(p_organization_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_revision bigint;
BEGIN
  UPDATE public.lemtel_organizations
     SET account_authority_revision = account_authority_revision + 1
   WHERE id = p_organization_id
   RETURNING account_authority_revision INTO v_revision;

  IF v_revision IS NULL THEN
    RAISE EXCEPTION 'lemtel organization not found';
  END IF;
  RETURN v_revision;
END;
$$;

CREATE OR REPLACE FUNCTION public.lemtel_membership_authority_revision_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_organization_id uuid;
BEGIN
  v_organization_id := COALESCE(NEW.organization_id, OLD.organization_id);
  PERFORM public.lemtel_bump_account_authority_revision(v_organization_id);
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lemtel_membership_authority_revision_after_change
  ON public.lemtel_organization_memberships;
CREATE TRIGGER lemtel_membership_authority_revision_after_change
AFTER INSERT OR UPDATE OF role, status OR DELETE
ON public.lemtel_organization_memberships
FOR EACH ROW EXECUTE FUNCTION public.lemtel_membership_authority_revision_trigger();

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
      'user_access_suspended',
      'temporary_password_rotated'
    )
  );

REVOKE ALL ON FUNCTION public.lemtel_bump_account_authority_revision(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lemtel_bump_account_authority_revision(uuid)
  TO service_role;

COMMENT ON COLUMN public.lemtel_organizations.account_authority_revision IS
  'Server-only monotonic revision for account, membership and access synchronization. It contains no credential, account email or telephony setting.';
COMMENT ON FUNCTION public.lemtel_bump_account_authority_revision(uuid) IS
  'Server-only Lemtel account-authority revision bump; no user or secret is returned.';

COMMIT;
