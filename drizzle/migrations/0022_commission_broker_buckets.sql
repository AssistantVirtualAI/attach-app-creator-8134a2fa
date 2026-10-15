CREATE TABLE public.planipret_commission_broker_aggregates (
  bucket_key text PRIMARY KEY,
  kind text NOT NULL,
  owner_key text,
  fiscal_year integer,
  rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  row_count integer NOT NULL DEFAULT 0,
  data_hash text,
  source_max_updated_at timestamptz,
  built_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.planipret_commission_broker_aggregates TO service_role;
ALTER TABLE public.planipret_commission_broker_aggregates ENABLE ROW LEVEL SECURITY;
CREATE INDEX planipret_commission_broker_aggregates_kind_year_idx ON public.planipret_commission_broker_aggregates (kind, fiscal_year);
COMMENT ON TABLE public.planipret_commission_broker_aggregates IS 'Server-only per-broker/per-year pre-shaped commission rows; rebuilt only for buckets whose source rows changed.';

ALTER TABLE public.planipret_commission_source_state ADD COLUMN IF NOT EXISTS last_review jsonb;
ALTER TABLE public.planipret_commission_source_state ADD COLUMN IF NOT EXISTS last_review_at timestamptz;

CREATE INDEX IF NOT EXISTS planipret_commission_live_cache_updated_at_idx ON public.planipret_commission_live_cache (updated_at);
CREATE INDEX IF NOT EXISTS planipret_commission_register_updated_at_idx ON public.planipret_commission_register (updated_at);