-- Lemtel session-bootstrap authority — source package only. Apply only with explicit writer approval.
-- Resolves a user's active Lemtel memberships and organizations in one server-only query.
-- It creates no Auth user, stores no credential, modifies no membership, and never contacts telephony infrastructure.

BEGIN;

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
