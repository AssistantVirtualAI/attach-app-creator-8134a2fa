-- Lemtel aggregate traffic only. Offline source; applying requires separate approval.
BEGIN;

CREATE TABLE public.lemtel_traffic_samples (
  node_role text NOT NULL CHECK (node_role IN ('do_writer', 'hostinger_standby')),
  observed_at timestamptz NOT NULL CHECK (
    observed_at >= '2026-01-01T00:00:00Z'::timestamptz
    AND observed_at < '2100-01-01T00:00:00Z'::timestamptz
    AND observed_at = date_trunc('minute', observed_at)
  ),
  period_seconds integer NOT NULL CHECK (period_seconds BETWEEN 30 AND 300),
  rx_bytes bigint NOT NULL CHECK (rx_bytes BETWEEN 0 AND 1000000000000),
  tx_bytes bigint NOT NULL CHECK (tx_bytes BETWEEN 0 AND 1000000000000),
  tcp_established integer NOT NULL CHECK (tcp_established BETWEEN 0 AND 1000000),
  collector_state text NOT NULL DEFAULT 'collecting' CHECK (collector_state = 'collecting'),
  PRIMARY KEY (node_role, observed_at)
);
CREATE INDEX lemtel_traffic_samples_timestamp_role_idx
  ON public.lemtel_traffic_samples (observed_at DESC, node_role);

-- No client policies: only the private service-role Edge path can read/insert.
ALTER TABLE public.lemtel_traffic_samples ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lemtel_traffic_samples FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.lemtel_traffic_samples TO service_role;

-- First insert wins; no UPDATE grant. Replays use the composite primary key.
-- Physical cleanup resumes on insert; expired rows are always excluded from reads.
CREATE FUNCTION public.lemtel_traffic_retention() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.observed_at < clock_timestamp() - interval '180 seconds'
     OR NEW.observed_at > clock_timestamp() + interval '120 seconds' THEN
    RAISE EXCEPTION 'lemtel_traffic_clock_skew' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.lemtel_traffic_samples
    WHERE observed_at < clock_timestamp() - interval '7 days';
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.lemtel_traffic_retention() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER lemtel_traffic_retention_before_insert
  BEFORE INSERT ON public.lemtel_traffic_samples
  FOR EACH ROW EXECUTE FUNCTION public.lemtel_traffic_retention();

COMMENT ON TABLE public.lemtel_traffic_samples IS
  'Lemtel-only role/minute/interval/byte deltas/aggregate established TCP count/collector state. No identifiers or network details. Seven-day retention; platform-admin 24-hour read via Edge only.';
COMMIT;
