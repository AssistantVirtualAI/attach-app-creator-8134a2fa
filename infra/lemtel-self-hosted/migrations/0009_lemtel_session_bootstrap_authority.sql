-- Lemtel session-bootstrap authority — source package only. Apply only with explicit writer approval.
-- Resolves a user's active Lemtel memberships and organizations in one server-only query.
-- It creates no Auth user, stores no credential, modifies no membership, and never contacts telephony infrastructure.

BEGIN;

-- Some previously provisioned Lemtel writers contain memberships but predate
-- the account-authority revision column. Install only this missing prerequisite;
-- do not replay the historical audit-constraint migration.
ALTER TABLE public.lemtel_organizations
  ADD COLUMN IF NOT EXISTS account_authority_revision bigint NOT NULL DEFAULT 1;

ALTER TABLE public.lemtel_organizations
  DROP CONSTRAINT IF EXISTS lemtel_organizations_account_authority_revision_check;
ALTER TABLE public.lemtel_organizations
  ADD CONSTRAINT lemtel_organizations_account_authority_revision_check
  CHECK (account_authority_revision > 0);

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

REVOKE ALL ON FUNCTION public.lemtel_bump_account_authority_revision(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lemtel_bump_account_authority_revision(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.lemtel_session_bootstrap_context(p_user_id uuid)
RETURNS TABLE (
  organization_id uuid,
  membership_role text,
  organization_display_name text,
  organization_slug text,
  account_authority_revision bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    membership.organization_id,
    membership.role,
    organization.display_name,
    organization.slug,
    organization.account_authority_revision
  FROM public.lemtel_organization_memberships AS membership
  INNER JOIN public.lemtel_organizations AS organization
    ON organization.id = membership.organization_id
  WHERE membership.user_id = p_user_id
    AND membership.status = 'active'
    AND organization.status = 'active'
  ORDER BY organization.display_name, organization.id;
$$;

REVOKE ALL ON FUNCTION public.lemtel_session_bootstrap_context(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lemtel_session_bootstrap_context(uuid)
  TO service_role;

COMMENT ON FUNCTION public.lemtel_session_bootstrap_context(uuid) IS
  'Server-only active Lemtel organization authority for authenticated Desktop and Mobile session bootstrap; excludes credentials and telephony configuration.';

COMMIT;
