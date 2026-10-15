-- Lemtel telephony preparation governance — source package only.
-- This schema stores only an organization-scoped review marker for an existing
-- Lemtel capability. It stores no provider configuration, call/media data,
-- identity, destination, credential, address, phone number, or client secret.
BEGIN;

CREATE TABLE IF NOT EXISTS public.lemtel_telephony_preparation_states (
  organization_id uuid NOT NULL REFERENCES public.lemtel_organizations(id) ON DELETE CASCADE,
  capability_key text NOT NULL CHECK (capability_key ~ '^[a-z][a-z0-9_]{2,63}$'),
  state text NOT NULL CHECK (state = 'review_ready'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 1000000),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by uuid NOT NULL,
  PRIMARY KEY (organization_id, capability_key)
);
CREATE INDEX IF NOT EXISTS lemtel_telephony_preparation_states_organization_updated_idx
  ON public.lemtel_telephony_preparation_states (organization_id, updated_at DESC);

ALTER TABLE public.lemtel_telephony_preparation_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lemtel_telephony_preparation_states FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lemtel_telephony_preparation_states TO service_role;

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
    'client_session_access_reactivated',
    'organization_updated',
    'organization_archived',
    'telephony_preparation_review_ready',
    'telephony_preparation_reset'
  ));

CREATE OR REPLACE FUNCTION public.lemtel_set_telephony_preparation_state(
  p_organization_id uuid,
  p_capability_key text,
  p_state text,
  p_actor_id uuid
) RETURNS TABLE(state text, revision integer, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_organization_id IS NULL OR p_actor_id IS NULL
    OR p_capability_key !~ '^[a-z][a-z0-9_]{2,63}$'
    OR p_state NOT IN ('not_started', 'review_ready') THEN
    RAISE EXCEPTION 'lemtel_invalid_telephony_preparation_state' USING ERRCODE = '22023';
  END IF;

  IF p_state = 'not_started' THEN
    DELETE FROM public.lemtel_telephony_preparation_states
      WHERE organization_id = p_organization_id AND capability_key = p_capability_key;
    INSERT INTO public.lemtel_onboarding_audit (organization_id, actor_id, subject_user_id, action, metadata)
      VALUES (p_organization_id, p_actor_id, NULL, 'telephony_preparation_reset', '{}'::jsonb);
    RETURN QUERY SELECT 'not_started'::text, 0::integer, NULL::timestamptz;
    RETURN;
  END IF;

  INSERT INTO public.lemtel_telephony_preparation_states (
    organization_id, capability_key, state, revision, updated_at, updated_by
  ) VALUES (
    p_organization_id, p_capability_key, 'review_ready', 1, clock_timestamp(), p_actor_id
  ) ON CONFLICT (organization_id, capability_key) DO UPDATE SET
    state = EXCLUDED.state,
    revision = public.lemtel_telephony_preparation_states.revision + 1,
    updated_at = clock_timestamp(),
    updated_by = EXCLUDED.updated_by;

  INSERT INTO public.lemtel_onboarding_audit (organization_id, actor_id, subject_user_id, action, metadata)
    VALUES (p_organization_id, p_actor_id, NULL, 'telephony_preparation_review_ready', '{}'::jsonb);

  RETURN QUERY
    SELECT prepared.state, prepared.revision, prepared.updated_at
    FROM public.lemtel_telephony_preparation_states AS prepared
    WHERE prepared.organization_id = p_organization_id AND prepared.capability_key = p_capability_key;
END;
$$;
REVOKE ALL ON FUNCTION public.lemtel_set_telephony_preparation_state(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lemtel_set_telephony_preparation_state(uuid, text, text, uuid) TO service_role;

COMMENT ON TABLE public.lemtel_telephony_preparation_states IS
  'Lemtel-only, tenant-scoped capability review markers. No PBX/provider configuration, secrets, media, calls, messages, numbers, addresses, or customer data.';
COMMENT ON FUNCTION public.lemtel_set_telephony_preparation_state(uuid, text, text, uuid) IS
  'Service-role-only Lemtel state transition for a catalog capability. review_ready is not activation and never contacts a provider.';

COMMIT;
