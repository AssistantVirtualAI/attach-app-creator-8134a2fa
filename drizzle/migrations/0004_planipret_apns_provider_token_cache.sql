CREATE TABLE public.planipret_apns_provider_tokens (
  cache_key text PRIMARY KEY,
  provider_token text,
  issued_at bigint,
  lease_owner uuid,
  lease_until timestamptz
);
GRANT ALL ON public.planipret_apns_provider_tokens TO service_role;
REVOKE ALL ON public.planipret_apns_provider_tokens FROM PUBLIC, anon, authenticated;
ALTER TABLE public.planipret_apns_provider_tokens ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.planipret_apns_provider_tokens IS 'Server-only APNs bearer token cache; never expose tokens or private keys to clients or logs.';
CREATE OR REPLACE FUNCTION public.pp_apns_claim_token(_cache_key text, _owner uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r public.planipret_apns_provider_tokens%ROWTYPE; ts bigint := floor(extract(epoch from clock_timestamp()));
BEGIN
  IF _cache_key IS NULL OR _cache_key !~ '^[a-f0-9]{64}$' OR _owner IS NULL THEN RAISE EXCEPTION 'invalid_cache_request'; END IF;
  INSERT INTO public.planipret_apns_provider_tokens(cache_key) VALUES (_cache_key) ON CONFLICT DO NOTHING;
  SELECT * INTO r FROM public.planipret_apns_provider_tokens WHERE cache_key = _cache_key FOR UPDATE;
  IF r.provider_token IS NOT NULL AND r.issued_at <= ts AND r.issued_at > ts - 2400 THEN
    RETURN jsonb_build_object('token', r.provider_token, 'issued_at', r.issued_at);
  END IF;
  IF r.lease_until IS NOT NULL AND r.lease_until > clock_timestamp() THEN RETURN jsonb_build_object('waiting', true); END IF;
  UPDATE public.planipret_apns_provider_tokens SET lease_owner = _owner, lease_until = clock_timestamp() + interval '15 seconds' WHERE cache_key = _cache_key;
  RETURN jsonb_build_object('claimed', true, 'issued_at', ts);
END;
$$;
CREATE OR REPLACE FUNCTION public.pp_apns_publish_token(_cache_key text, _owner uuid, _token text, _issued_at bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE n integer; ts bigint := floor(extract(epoch from clock_timestamp()));
BEGIN
  IF _token IS NULL OR length(_token) > 2048 OR _token !~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' OR _issued_at IS NULL OR _issued_at > ts OR _issued_at < ts - 30 THEN RAISE EXCEPTION 'invalid_provider_token'; END IF;
  UPDATE public.planipret_apns_provider_tokens SET provider_token = _token, issued_at = _issued_at, lease_owner = NULL, lease_until = NULL
  WHERE cache_key = _cache_key AND lease_owner = _owner AND lease_until > clock_timestamp();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END;
$$;
REVOKE ALL ON FUNCTION public.pp_apns_claim_token(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pp_apns_publish_token(text, uuid, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pp_apns_claim_token(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pp_apns_publish_token(text, uuid, text, bigint) TO service_role;