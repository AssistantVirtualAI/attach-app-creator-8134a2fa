-- Lemtel client connection presence — source package only.
-- Stores minimal, server-derived recent client presence for authorized portal administrators.
-- No device fingerprint, IP address, token, password, call data, recording, chat or telephony setting is stored.

BEGIN;

CREATE TABLE IF NOT EXISTS public.lemtel_client_connection_presence (
  organization_id uuid NOT NULL REFERENCES public.lemtel_organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_kind text NOT NULL CHECK (client_kind IN ('mobile', 'desktop', 'portal', 'client')),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  authority_revision bigint NOT NULL CHECK (authority_revision > 0),
  PRIMARY KEY (organization_id, user_id, client_kind)
);

CREATE INDEX IF NOT EXISTS lemtel_client_connection_presence_organization_seen_idx
  ON public.lemtel_client_connection_presence (organization_id, last_seen_at DESC);

ALTER TABLE public.lemtel_client_connection_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lemtel_client_connection_presence FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.lemtel_record_client_connection(
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
    organization_id,
    user_id,
    client_kind,
    last_seen_at,
    authority_revision
  )
  SELECT
    context.organization_id,
    p_user_id,
    v_client_kind,
    now(),
    context.account_authority_revision
  FROM public.lemtel_session_bootstrap_context(p_user_id) AS context
  ON CONFLICT (organization_id, user_id, client_kind) DO UPDATE
    SET last_seen_at = EXCLUDED.last_seen_at,
        authority_revision = EXCLUDED.authority_revision;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.lemtel_record_client_connection(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lemtel_record_client_connection(uuid, text)
  TO service_role;

COMMENT ON TABLE public.lemtel_client_connection_presence IS
  'Lemtel-only minimal recent application presence, read solely through the authenticated Lemtel portal authority. It deliberately excludes device identifiers, network addresses, credentials and communication content.';

COMMENT ON FUNCTION public.lemtel_record_client_connection(uuid, text) IS
  'Server-only best-effort Lemtel client presence marker derived from authenticated session bootstrap. It does not authenticate, authorize or provision telephony.';

COMMIT;
