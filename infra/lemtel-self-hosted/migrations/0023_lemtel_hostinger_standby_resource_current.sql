-- Lemtel Hostinger standby resources: current redacted singleton only, from a role-bound signed publisher that is NOT a secure enrollment. Applying requires a separately reviewed deployment.
BEGIN;
CREATE TABLE public.lemtel_hostinger_standby_resource_current (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  observed_at timestamptz NOT NULL CHECK (observed_at = date_trunc('minute', observed_at) AND observed_at >= '2026-01-01T00:00:00Z'::timestamptz AND observed_at < '2100-01-01T00:00:00Z'::timestamptz),
  cpu_percent smallint NOT NULL CHECK (cpu_percent BETWEEN 0 AND 100),
  memory_percent smallint NOT NULL CHECK (memory_percent BETWEEN 0 AND 100),
  disk_percent smallint NOT NULL CHECK (disk_percent BETWEEN 0 AND 100),
  load1_milli integer NOT NULL CHECK (load1_milli BETWEEN 0 AND 1000000),
  load5_milli integer NOT NULL CHECK (load5_milli BETWEEN 0 AND 1000000),
  load15_milli integer NOT NULL CHECK (load15_milli BETWEEN 0 AND 1000000)
);
ALTER TABLE public.lemtel_hostinger_standby_resource_current ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lemtel_hostinger_standby_resource_current FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.lemtel_hostinger_standby_resource_current TO service_role;
CREATE FUNCTION public.lemtel_record_hostinger_standby_resource_status(
  p_observed_at timestamptz, p_cpu_percent smallint, p_memory_percent smallint, p_disk_percent smallint,
  p_load1_milli integer, p_load5_milli integer, p_load15_milli integer
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_observed_at IS NULL OR p_observed_at <> date_trunc('minute', p_observed_at)
    OR p_observed_at < '2026-01-01T00:00:00Z'::timestamptz OR p_observed_at >= '2100-01-01T00:00:00Z'::timestamptz
    OR p_cpu_percent IS NULL OR p_cpu_percent NOT BETWEEN 0 AND 100
    OR p_memory_percent IS NULL OR p_memory_percent NOT BETWEEN 0 AND 100
    OR p_disk_percent IS NULL OR p_disk_percent NOT BETWEEN 0 AND 100
    OR p_load1_milli IS NULL OR p_load1_milli NOT BETWEEN 0 AND 1000000
    OR p_load5_milli IS NULL OR p_load5_milli NOT BETWEEN 0 AND 1000000
    OR p_load15_milli IS NULL OR p_load15_milli NOT BETWEEN 0 AND 1000000 THEN
    RAISE EXCEPTION 'invalid redacted resource observation' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.lemtel_hostinger_standby_resource_current (
    singleton, observed_at, cpu_percent, memory_percent, disk_percent, load1_milli, load5_milli, load15_milli
  ) VALUES (true, p_observed_at, p_cpu_percent, p_memory_percent, p_disk_percent, p_load1_milli, p_load5_milli, p_load15_milli)
  ON CONFLICT (singleton) DO UPDATE SET
    observed_at = EXCLUDED.observed_at, cpu_percent = EXCLUDED.cpu_percent, memory_percent = EXCLUDED.memory_percent,
    disk_percent = EXCLUDED.disk_percent, load1_milli = EXCLUDED.load1_milli, load5_milli = EXCLUDED.load5_milli,
    load15_milli = EXCLUDED.load15_milli
  WHERE EXCLUDED.observed_at >= public.lemtel_hostinger_standby_resource_current.observed_at;
END;
$$;
REVOKE ALL ON FUNCTION public.lemtel_record_hostinger_standby_resource_status(timestamptz, smallint, smallint, smallint, integer, integer, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lemtel_record_hostinger_standby_resource_status(timestamptz, smallint, smallint, smallint, integer, integer, integer) TO service_role;
COMMENT ON TABLE public.lemtel_hostinger_standby_resource_current IS 'Lemtel current Hostinger standby resource projection (signed publication, not enrolled): rounded utilization and scaled load only. No node identity, capacity, network, traffic, customer, telephony or content data.';
COMMIT;
