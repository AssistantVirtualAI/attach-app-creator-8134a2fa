-- Lemtel self-hosted atomic draft RPC — OFFLINE ONLY; do not apply without separate target-write approval.
-- Requires the already applied Lemtel-only schema package. Creates no account, organization, client configuration, bucket or release.

BEGIN;

CREATE OR REPLACE FUNCTION public.lemtel_mobile_config_draft_write(
  p_operation text,
  p_actor_id uuid,
  p_organization_id uuid,
  p_channel text,
  p_config_id uuid,
  p_revision integer,
  p_flags jsonb,
  p_messages jsonb,
  p_settings jsonb,
  p_min_version text,
  p_recommended_version text,
  p_maintenance_mode boolean,
  p_maintenance_message text
)
RETURNS TABLE (
  id uuid,
  channel text,
  revision integer,
  status text,
  flags jsonb,
  messages jsonb,
  settings jsonb,
  min_version text,
  recommended_version text,
  maintenance_mode boolean,
  maintenance_message text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_config public.lemtel_mobile_config_revisions%ROWTYPE;
BEGIN
  IF p_operation NOT IN ('create_draft', 'update_draft') OR p_actor_id IS NULL OR p_organization_id IS NULL OR p_channel NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'lemtel_draft_invalid_request' USING ERRCODE = '22023';
  END IF;

  SELECT membership.role
    INTO v_role
    FROM public.lemtel_organization_memberships AS membership
   WHERE membership.organization_id = p_organization_id
     AND membership.user_id = p_actor_id
     AND membership.status = 'active';

  IF NOT FOUND OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'lemtel_draft_forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_flags IS NULL OR p_messages IS NULL OR p_settings IS NULL
     OR jsonb_typeof(p_flags) <> 'object'
     OR jsonb_typeof(p_messages) <> 'object'
     OR jsonb_typeof(p_settings) <> 'object'
     OR octet_length(p_flags::text) > 16384
     OR octet_length(p_messages::text) > 16384
     OR octet_length(p_settings::text) > 16384
     OR p_maintenance_mode IS NULL
     OR (p_maintenance_message IS NOT NULL AND char_length(p_maintenance_message) > 512)
     OR (p_min_version IS NOT NULL AND p_min_version !~ '^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$')
     OR (p_recommended_version IS NOT NULL AND p_recommended_version !~ '^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$') THEN
    RAISE EXCEPTION 'lemtel_draft_invalid_payload' USING ERRCODE = '22023';
  END IF;

  IF p_operation = 'create_draft' THEN
    IF p_config_id IS NOT NULL OR p_revision IS NULL OR p_revision < 1 THEN
      RAISE EXCEPTION 'lemtel_draft_invalid_create' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.lemtel_mobile_config_revisions (
      organization_id, channel, revision, status, flags, messages, settings,
      min_version, recommended_version, maintenance_mode, maintenance_message, created_by
    ) VALUES (
      p_organization_id, p_channel, p_revision, 'draft', p_flags, p_messages, p_settings,
      p_min_version, p_recommended_version, p_maintenance_mode, p_maintenance_message, p_actor_id
    )
    RETURNING * INTO v_config;
  ELSE
    IF p_config_id IS NULL OR p_revision IS NOT NULL THEN
      RAISE EXCEPTION 'lemtel_draft_invalid_update' USING ERRCODE = '22023';
    END IF;

    UPDATE public.lemtel_mobile_config_revisions AS config
       SET flags = p_flags,
           messages = p_messages,
           settings = p_settings,
           min_version = p_min_version,
           recommended_version = p_recommended_version,
           maintenance_mode = p_maintenance_mode,
           maintenance_message = p_maintenance_message
     WHERE config.id = p_config_id
       AND config.organization_id = p_organization_id
       AND config.channel = p_channel
       AND config.status = 'draft'
    RETURNING * INTO v_config;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'lemtel_draft_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  INSERT INTO public.lemtel_mobile_admin_audit (
    organization_id, actor_id, action, subject_type, subject_id, metadata
  ) VALUES (
    p_organization_id,
    p_actor_id,
    'config_drafted',
    'config_revision',
    v_config.id,
    jsonb_build_object('operation', p_operation, 'channel', v_config.channel, 'revision', v_config.revision)
  );

  RETURN QUERY SELECT
    v_config.id,
    v_config.channel,
    v_config.revision,
    v_config.status,
    v_config.flags,
    v_config.messages,
    v_config.settings,
    v_config.min_version,
    v_config.recommended_version,
    v_config.maintenance_mode,
    v_config.maintenance_message,
    v_config.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.lemtel_mobile_config_draft_write(text, uuid, uuid, text, uuid, integer, jsonb, jsonb, jsonb, text, text, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lemtel_mobile_config_draft_write(text, uuid, uuid, text, uuid, integer, jsonb, jsonb, jsonb, text, text, boolean, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lemtel_mobile_config_draft_write(text, uuid, uuid, text, uuid, integer, jsonb, jsonb, jsonb, text, text, boolean, text) TO service_role;

COMMIT;
