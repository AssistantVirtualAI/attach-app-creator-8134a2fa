-- Lemtel ownership transfer — source package only. No data import, DNS, PBX or provider action is performed.
-- This transaction adds the audit action and a service-role-only, atomic ownership transfer primitive.
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
    'membership_role_changed',
    'organization_ownership_transferred'
  ));

CREATE OR REPLACE FUNCTION public.lemtel_transfer_organization_ownership(
  p_organization_id uuid,
  p_actor_id uuid,
  p_recipient_user_id uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_role text;
  v_actor_status text;
  v_recipient_role text;
  v_recipient_status text;
BEGIN
  IF p_actor_id = p_recipient_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ownership_transfer_recipient_invalid';
  END IF;

  SELECT role, status INTO v_actor_role, v_actor_status
    FROM public.lemtel_organization_memberships
    WHERE organization_id = p_organization_id AND user_id = p_actor_id
    FOR UPDATE;
  IF v_actor_role IS DISTINCT FROM 'owner' OR v_actor_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'organization_owner_required';
  END IF;

  SELECT role, status INTO v_recipient_role, v_recipient_status
    FROM public.lemtel_organization_memberships
    WHERE organization_id = p_organization_id AND user_id = p_recipient_user_id
    FOR UPDATE;
  IF v_recipient_role IS NULL OR v_recipient_status IS DISTINCT FROM 'active' OR v_recipient_role = 'owner' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ownership_transfer_recipient_invalid';
  END IF;

  UPDATE public.lemtel_organization_memberships
    SET role = 'admin'
    WHERE organization_id = p_organization_id AND user_id = p_actor_id;
  UPDATE public.lemtel_organization_memberships
    SET role = 'owner'
    WHERE organization_id = p_organization_id AND user_id = p_recipient_user_id;

  INSERT INTO public.lemtel_onboarding_audit (organization_id, actor_id, subject_user_id, action, metadata)
    VALUES (p_organization_id, p_actor_id, p_recipient_user_id, 'organization_ownership_transferred', '{"previous_owner_role":"admin","recipient_owner":true}'::jsonb);
  RETURN 'transferred';
END;
$$;

REVOKE ALL ON FUNCTION public.lemtel_transfer_organization_ownership(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lemtel_transfer_organization_ownership(uuid, uuid, uuid) TO service_role;

COMMIT;
