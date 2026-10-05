-- Lemtel self-hosted configuration publication RPC — OFFLINE ONLY; do not apply without separate target-write approval.
-- Requires the Lemtel-only schema package and writes no client data except a state transition and minimal audit row.

BEGIN;

CREATE OR REPLACE FUNCTION public.lemtel_mobile_config_publish(
  p_operation text,
  p_actor_id uuid,
  p_organization_id uuid,
  p_channel text,
  p_config_id uuid
)
RETURNS TABLE (
  id uuid,
  channel text,
  revision integer,
  status text,
  published_at timestamptz,
  retired_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_config public.lemtel_mobile_config_revisions%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_operation NOT IN ('publish', 'retire') OR p_actor_id IS NULL OR p_organization_id IS NULL OR p_channel NOT IN ('staging', 'production') OR p_config_id IS NULL THEN
    RAISE EXCEPTION 'lemtel_config_transition_invalid_request' USING ERRCODE = '22023';
  END IF;

  -- Serialize transitions per organization before changing the partial published index.
  PERFORM 1
    FROM public.lemtel_organizations AS organization
   WHERE organization.id = p_organization_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lemtel_config_transition_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT membership.role
    INTO v_role
    FROM public.lemtel_organization_memberships AS membership
   WHERE membership.organization_id = p_organization_id
     AND membership.user_id = p_actor_id
     AND membership.status = 'active';
  IF NOT FOUND OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'lemtel_config_transition_forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_operation = 'publish' THEN
    SELECT *
      INTO v_config
      FROM public.lemtel_mobile_config_revisions AS config
     WHERE config.id = p_config_id
       AND config.organization_id = p_organization_id
       AND config.channel = p_channel
       AND config.status = 'draft'
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'lemtel_config_draft_not_found' USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.lemtel_mobile_config_revisions AS existing
       SET status = 'retired',
           retired_at = v_now
     WHERE existing.organization_id = p_organization_id
       AND existing.channel = p_channel
       AND existing.status = 'published';

    UPDATE public.lemtel_mobile_config_revisions AS config
       SET status = 'published',
           published_by = p_actor_id,
           published_at = v_now,
           retired_at = NULL
     WHERE config.id = v_config.id
       AND config.organization_id = p_organization_id
       AND config.channel = p_channel
       AND config.status = 'draft'
    RETURNING * INTO v_config;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'lemtel_config_publish_conflict' USING ERRCODE = '40001';
    END IF;
  ELSE
    UPDATE public.lemtel_mobile_config_revisions AS config
       SET status = 'retired',
           retired_at = v_now
     WHERE config.id = p_config_id
       AND config.organization_id = p_organization_id
       AND config.channel = p_channel
       AND config.status = 'published'
    RETURNING * INTO v_config;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'lemtel_config_published_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  INSERT INTO public.lemtel_mobile_admin_audit (
    organization_id, actor_id, action, subject_type, subject_id, metadata
  ) VALUES (
    p_organization_id,
    p_actor_id,
    CASE WHEN p_operation = 'publish' THEN 'config_published' ELSE 'config_retired' END,
    'config_revision',
    v_config.id,
    jsonb_build_object('operation', p_operation, 'channel', v_config.channel, 'revision', v_config.revision)
  );

  RETURN QUERY SELECT
    v_config.id,
    v_config.channel,
    v_config.revision,
    v_config.status,
    v_config.published_at,
    v_config.retired_at;
END;
$$;

REVOKE ALL ON FUNCTION public.lemtel_mobile_config_publish(text, uuid, uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lemtel_mobile_config_publish(text, uuid, uuid, text, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lemtel_mobile_config_publish(text, uuid, uuid, text, uuid) TO service_role;

COMMIT;
