CREATE TABLE public.ai_insights_cache (
  cache_key text PRIMARY KEY,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.ai_insights_cache TO service_role;
ALTER TABLE public.ai_insights_cache ENABLE ROW LEVEL SECURITY;