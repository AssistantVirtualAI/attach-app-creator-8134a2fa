-- Lemtel temporary-password recovery — OFFLINE ONLY; requires an explicit target-write approval.
-- Lemtel-only records and functions. No Planiprêt data, PBX changes, plaintext passwords,
-- Auth tokens, message bodies or provider credentials are stored.

BEGIN;

CREATE TABLE IF NOT EXISTS public.lemtel_password_reset_throttles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.lemtel_organizations(id) ON DELETE CASCADE,
  next_allowed_at timestamptz NOT NULL,
  last_requested_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lemtel_password_reset_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.lemtel_organizations(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  locale text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  provider_message_id text,
  attempted_at timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lemtel_password_reset_delivery_locale_check CHECK (locale IN ('fr', 'en')),
  CONSTRAINT lemtel_password_reset_delivery_state_check CHECK (state IN ('pending', 'sent', 'failed'))
);

CREATE INDEX IF NOT EXISTS lemtel_password_reset_delivery_recipient_idx
  ON public.lemtel_password_reset_delivery_attempts (recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lemtel_password_reset_delivery_organization_idx
  ON public.lemtel_password_reset_delivery_attempts (organization_id, created_at DESC);

-- Service-role only: finds an active Lemtel email-only user. The Edge function always
-- returns a generic accepted response, so callers cannot use this to enumerate accounts.
CREATE OR REPLACE FUNCTION public.lemtel_find_password_reset_recipient(p_email text)
RETURNS TABLE (
  user_id uuid,
  organization_id uuid,
  display_name text,
  locale text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    u.id,
    membership.organization_id,
    COALESCE(NULLIF(trim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email, '@', 1)) AS display_name,
    CASE WHEN u.raw_user_meta_data ->> 'locale' = 'en' THEN 'en' ELSE 'fr' END AS locale
  FROM auth.users AS u
  JOIN public.lemtel_organization_memberships AS membership
    ON membership.user_id = u.id
   AND membership.status = 'active'
  JOIN public.lemtel_organizations AS organization
    ON organization.id = membership.organization_id
   AND organization.status = 'active'
  WHERE lower(u.email) = lower(trim(p_email))
    AND COALESCE(u.raw_app_meta_data ->> 'lemtel_email_only_signin', 'false') = 'true'
  ORDER BY membership.created_at ASC
  LIMIT 1;
$$;

-- Atomically claims one reset window per Lemtel user. A delivery is represented only by
-- non-secret metadata; the temporary password remains in Auth and the outbound email.
CREATE OR REPLACE FUNCTION public.lemtel_claim_password_reset(
  p_user_id uuid,
  p_organization_id uuid,
  p_locale text,
  p_cooldown_seconds integer DEFAULT 900
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt_id uuid;
BEGIN
  IF p_cooldown_seconds < 60 OR p_cooldown_seconds > 86400 THEN
    RAISE EXCEPTION 'invalid cooldown';
  END IF;
  IF p_locale NOT IN ('fr', 'en') THEN
    RAISE EXCEPTION 'invalid locale';
  END IF;

  INSERT INTO public.lemtel_password_reset_throttles (
    user_id, organization_id, next_allowed_at, last_requested_at, updated_at
  ) VALUES (
    p_user_id, p_organization_id, now() + make_interval(secs => p_cooldown_seconds), now(), now()
  )
  ON CONFLICT (user_id) DO UPDATE
    SET organization_id = EXCLUDED.organization_id,
        next_allowed_at = EXCLUDED.next_allowed_at,
        last_requested_at = EXCLUDED.last_requested_at,
        updated_at = EXCLUDED.updated_at
  WHERE public.lemtel_password_reset_throttles.next_allowed_at <= now();

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.lemtel_password_reset_delivery_attempts (
    organization_id, recipient_user_id, locale, state
  ) VALUES (
    p_organization_id, p_user_id, p_locale, 'pending'
  ) RETURNING id INTO v_attempt_id;

  RETURN v_attempt_id;
END;
$$;

-- Allows the server to release only a failed delivery window so the recipient can request
-- a freshly generated temporary password. It never returns a password or email address.
CREATE OR REPLACE FUNCTION public.lemtel_release_failed_password_reset(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.lemtel_password_reset_throttles
     SET next_allowed_at = now(), updated_at = now()
   WHERE user_id = p_user_id;
$$;

REVOKE ALL ON public.lemtel_password_reset_throttles FROM anon, authenticated;
REVOKE ALL ON public.lemtel_password_reset_delivery_attempts FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.lemtel_find_password_reset_recipient(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lemtel_claim_password_reset(uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lemtel_release_failed_password_reset(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lemtel_find_password_reset_recipient(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lemtel_claim_password_reset(uuid, uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.lemtel_release_failed_password_reset(uuid) TO service_role;

ALTER TABLE public.lemtel_password_reset_throttles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lemtel_password_reset_delivery_attempts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.lemtel_password_reset_throttles IS
  'Lemtel-only throttle state for temporary-password recovery. No password, token, recipient email or message content is stored.';
COMMENT ON TABLE public.lemtel_password_reset_delivery_attempts IS
  'Lemtel-only temporary-password recovery delivery metadata. Plaintext passwords, Auth tokens, provider credentials and email bodies are never stored.';

COMMIT;
