-- Lemtel client-session controls — source package only.
-- Controls only the server bootstrap eligibility of the declared Lemtel client family.
-- It never stores device identifiers, tokens, fingerprints, addresses, calls, media or telephony settings.
BEGIN;

CREATE TABLE IF NOT EXISTS public.lemtel_client_session_controls (
  organization_id uuid NOT NULL REFERENCES public.lemtel_organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_kind text NOT NULL CHECK (client_kind IN ('mobile', 'desktop', 'client')),
  access_state text NOT NULL DEFAULT 'active' CHECK (access_state IN ('active', 'revoked')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES auth.users(id),
  PRIMARY KEY (organization_id, user_id, client_kind)
);

CREATE INDEX IF NOT EXISTS lemtel_client_session_controls_organization_idx
  ON public.lemtel_client_session_controls (organization_id, user_id, client_kind);

ALTER TABLE public.lemtel_client_session_controls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lemtel_client_session_controls FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.lemtel_session_bootstrap_context_for_client(
  p_user_id uuid,
  p_client_kind text
)
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
  LEFT JOIN public.lemtel_client_session_controls AS control
    ON control.organization_id = membership.organization_id
    AND control.user_id = membership.user_id
    AND control.client_kind = CASE WHEN p_client_kind IN ('mobile', 'desktop') THEN p_client_kind ELSE 'client' END
  WHERE membership.user_id = p_user_id
    AND membership.status = 'active'
    AND organization.status = 'active'
    AND COALESCE(control.access_state, 'active') = 'active'
  ORDER BY organization.display_name, organization.id;
$$;

CREATE OR REPLACE FUNCTION public.lemtel_record_authorized_client_connection(
  p_user_id uuid,
  p_client_kind text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_kind text;
  v_count integer := 0;
BEGIN
  v_client_kind := CASE
    WHEN p_client_kind IN ('mobile', 'desktop', 'portal') THEN p_client_kind
    ELSE 'client'
  END;

  INSERT INTO public.lemtel_client_connection_presence (
    organization_id, user_id, client_kind, last_seen_at, authority_revision
  )
  SELECT
    context.organization_id, p_user_id, v_client_kind, now(), context.account_authority_revision
  FROM public.lemtel_session_bootstrap_context_for_client(p_user_id, v_client_kind) AS context
  ON CONFLICT (organization_id, user_id, client_kind) DO UPDATE
    SET last_seen_at = EXCLUDED.last_seen_at,
        authority_revision = EXCLUDED.authority_revision;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

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
    'membership_role_changed',
    'organization_ownership_transferred',
    'client_session_access_revoked',
    'client_session_access_reactivated'
  ));

REVOKE ALL ON FUNCTION public.lemtel_session_bootstrap_context_for_client(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lemtel_session_bootstrap_context_for_client(uuid, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.lemtel_record_authorized_client_connection(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lemtel_record_authorized_client_connection(uuid, text)
  TO service_role;

COMMENT ON TABLE public.lemtel_client_session_controls IS
  'Lemtel-only client-family bootstrap controls. No device identifier, credential, network metadata or communication data is retained.';
COMMENT ON FUNCTION public.lemtel_session_bootstrap_context_for_client(uuid, text) IS
  'Lemtel-only authoritative session context filtered by active membership and client-family access state.';

COMMIT;
