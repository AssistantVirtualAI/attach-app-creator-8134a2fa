-- Internal alerts and commission warming must not depend on a service-role key
-- copied into Vault.  Generate a dedicated random secret in Vault and send it
-- only over the database-to-Edge HTTPS path.  The Edge function verifies the
-- candidate through an RPC that only service_role may execute.
DO $$
DECLARE
  _existing uuid;
  _created uuid;
BEGIN
  SELECT id INTO _existing
  FROM vault.secrets
  WHERE name = 'PP_INTERNAL_TRIGGER_SECRET'
  LIMIT 1;

  IF _existing IS NULL THEN
    SELECT vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'PP_INTERNAL_TRIGGER_SECRET'
    ) INTO _created;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.pp_verify_internal_trigger_secret(_candidate text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  _expected text;
BEGIN
  IF _candidate IS NULL OR length(_candidate) < 48 OR length(_candidate) > 256 THEN
    RETURN false;
  END IF;

  SELECT decrypted_secret INTO _expected
  FROM vault.decrypted_secrets
  WHERE name = 'PP_INTERNAL_TRIGGER_SECRET'
  LIMIT 1;

  RETURN _expected IS NOT NULL AND _candidate = _expected;
END
$$;

REVOKE ALL ON FUNCTION public.pp_verify_internal_trigger_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pp_verify_internal_trigger_secret(text) TO service_role;

-- Replace the prior trigger function.  Rows still only provide a table and a
-- UUID; pp-row-push re-reads the row with its service role after it verifies
-- this database-only secret.
CREATE OR REPLACE FUNCTION public.pp_row_push_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, vault
AS $$
DECLARE
  _internal_secret text;
BEGIN
  SELECT decrypted_secret INTO _internal_secret
  FROM vault.decrypted_secrets
  WHERE name = 'PP_INTERNAL_TRIGGER_SECRET'
  LIMIT 1;

  IF _internal_secret IS NULL OR length(trim(_internal_secret)) < 48 THEN
    RAISE WARNING 'pp_row_push_notify: internal trigger secret is not configured';
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := 'https://gejxisrqtvxavbrfcoxz.supabase.co/functions/v1/pp-row-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Planipret-Internal-Trigger', _internal_secret
      ),
      body := jsonb_build_object('table', TG_TABLE_NAME, 'id', NEW.id)
    );
  EXCEPTION WHEN OTHERS THEN
    -- A notification must never block storing an SMS, call or voicemail.
    NULL;
  END;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pp_row_push_notify() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pp_row_push_notify() TO service_role;

-- Replace the scheduled warm-up function.  It reuses the authenticated
-- internal trigger endpoint, which invokes the reports function server-side
-- with its own configured service role.  No service-role key enters Vault.
CREATE OR REPLACE FUNCTION public.pp_warm_commission_snapshots()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, vault
AS $$
DECLARE
  _internal_secret text;
BEGIN
  SELECT decrypted_secret INTO _internal_secret
  FROM vault.decrypted_secrets
  WHERE name = 'PP_INTERNAL_TRIGGER_SECRET'
  LIMIT 1;

  IF _internal_secret IS NULL OR length(trim(_internal_secret)) < 48 THEN
    RAISE WARNING 'pp_warm_commission_snapshots: internal trigger secret is not configured';
    RETURN;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := 'https://gejxisrqtvxavbrfcoxz.supabase.co/functions/v1/pp-row-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Planipret-Internal-Trigger', _internal_secret
      ),
      body := jsonb_build_object('action', 'warm_commission_snapshots')
    );
  EXCEPTION WHEN OTHERS THEN
    -- Cache warming is best effort; it must never impact a user request.
    NULL;
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pp_warm_commission_snapshots() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pp_warm_commission_snapshots() TO service_role;
