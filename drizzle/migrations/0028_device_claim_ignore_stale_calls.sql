CREATE OR REPLACE FUNCTION public.pp_claim_mobile_device(_user_id uuid, _device_id text, _platform text)
RETURNS TABLE(active boolean, deferred boolean, replaced boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_broker_id uuid;
  v_active_device_id text;
  v_replaced boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = '42501';
  END IF;
  IF _user_id IS NULL OR _device_id IS NULL OR _device_id !~ '^[A-Za-z0-9_-]{16,128}$'
     OR _platform IS NULL OR _platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'invalid device claim parameters' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_user_id::text, 0));

  SELECT p.id INTO v_broker_id
  FROM public.planipret_profiles p WHERE p.user_id = _user_id;
  IF v_broker_id IS NULL THEN
    RAISE EXCEPTION 'broker profile not found' USING ERRCODE = '22023';
  END IF;

  SELECT d.device_id INTO v_active_device_id
  FROM public.planipret_mobile_active_device d
  WHERE d.user_id = _user_id FOR UPDATE;

  IF v_active_device_id = _device_id THEN
    RETURN QUERY SELECT true, false, false;
    RETURN;
  END IF;

  -- Only recent, live calls defer the switch; never-closed rows must not block forever.
  IF EXISTS (
    SELECT 1 FROM public.planipret_call_sessions s
    WHERE s.broker_id = v_broker_id
      AND ((s.state = 'ringing' AND s.updated_at > now() - interval '2 minutes')
        OR (s.state = 'active' AND s.updated_at > now() - interval '4 hours'))
  ) THEN
    RETURN QUERY SELECT false, true, false;
    RETURN;
  END IF;

  v_replaced := v_active_device_id IS NOT NULL AND v_active_device_id <> _device_id;

  INSERT INTO public.planipret_mobile_active_device(user_id, device_id, platform, activated_at)
  VALUES (_user_id, _device_id, _platform, now())
  ON CONFLICT (user_id) DO UPDATE
    SET device_id = EXCLUDED.device_id, platform = EXCLUDED.platform, activated_at = EXCLUDED.activated_at;

  UPDATE public.planipret_voip_push_tokens
  SET revoked_at = now()
  WHERE user_id = _user_id AND device_id IS DISTINCT FROM _device_id AND revoked_at IS NULL;
  UPDATE public.mobile_push_tokens
  SET revoked_at = now()
  WHERE user_id = _user_id AND device_id IS DISTINCT FROM _device_id AND revoked_at IS NULL;

  UPDATE public.planipret_voip_push_tokens
  SET revoked_at = NULL
  WHERE user_id = _user_id AND device_id = _device_id AND revoked_at IS NOT NULL;
  UPDATE public.mobile_push_tokens
  SET revoked_at = NULL
  WHERE user_id = _user_id AND device_id = _device_id AND revoked_at IS NOT NULL;

  RETURN QUERY SELECT true, false, v_replaced;
END;
$$;
REVOKE ALL ON FUNCTION public.pp_claim_mobile_device(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pp_claim_mobile_device(uuid, text, text) TO service_role;