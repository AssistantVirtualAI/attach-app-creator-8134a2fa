-- The legacy five-minute warmer duplicates the audited 15-minute Planiprêt job
-- and causes repeated live reads (including advisory AI validation). Keep only
-- pp-commission-snapshot-warm-15min, installed by migration 0010.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pp-commission-snapshots-hourly') THEN
    PERFORM cron.unschedule('pp-commission-snapshots-hourly');
  END IF;
END $$;
