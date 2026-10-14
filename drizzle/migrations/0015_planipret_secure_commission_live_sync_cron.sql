-- Replace the legacy live-commission cron, which embedded credentials in its
-- pg_cron command. The job itself contains no secret: this SECURITY DEFINER
-- bridge reads the dedicated Vault secret introduced in 0011 only at runtime.
-- The target Edge Function verifies it via a service-role-only RPC.
CREATE OR REPLACE FUNCTION public.pp_run_commission_live_sync()
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
    RAISE WARNING 'pp_run_commission_live_sync: internal trigger secret is not configured';
    RETURN;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := 'https://gejxisrqtvxavbrfcoxz.supabase.co/functions/v1/pp-commission-live-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Planipret-Internal-Trigger', _internal_secret
      ),
      body := '{}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    -- A cache sync must never block a database transaction or user request.
    NULL;
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pp_run_commission_live_sync() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pp_run_commission_live_sync() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pp-commission-live-sync-30min') THEN
    PERFORM cron.unschedule('pp-commission-live-sync-30min');
  END IF;
END $$;

SELECT cron.schedule(
  'pp-commission-live-sync-30min',
  '*/30 * * * *',
  'SELECT public.pp_run_commission_live_sync();'
);
