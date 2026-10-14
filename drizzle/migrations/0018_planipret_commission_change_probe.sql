-- lovable-cron-fallback-reviewed: Maestro has no change webhook; user-required 15-min probe replaces two existing commission crons (net reduction).
CREATE TABLE IF NOT EXISTS public.planipret_commission_source_state (
  maestro_broker_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('paid','pending','global')),
  set_hash text,
  row_count integer NOT NULL DEFAULT 0,
  last_checked_at timestamptz,
  last_changed_at timestamptz,
  last_error text,
  PRIMARY KEY (maestro_broker_id, source)
);
GRANT ALL ON public.planipret_commission_source_state TO service_role;
ALTER TABLE public.planipret_commission_source_state ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.planipret_commission_rows (
  source text NOT NULL CHECK (source IN ('paid','pending')),
  maestro_broker_id text NOT NULL,
  row_key text NOT NULL,
  row_hash text NOT NULL,
  row_data jsonb NOT NULL,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  PRIMARY KEY (source, maestro_broker_id, row_key)
);
GRANT ALL ON public.planipret_commission_rows TO service_role;
ALTER TABLE public.planipret_commission_rows ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.planipret_commission_snapshots ADD COLUMN IF NOT EXISTS data_version text;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pp-commission-snapshot-warm-15min') THEN
    PERFORM cron.unschedule('pp-commission-snapshot-warm-15min');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pp-commission-live-sync-30min') THEN
    PERFORM cron.unschedule('pp-commission-live-sync-30min');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pp-commission-change-probe-15min') THEN
    PERFORM cron.unschedule('pp-commission-change-probe-15min');
  END IF;
END $$;

SELECT cron.schedule(
  'pp-commission-change-probe-15min',
  '*/15 * * * *',
  'SELECT public.pp_run_commission_live_sync();'
);