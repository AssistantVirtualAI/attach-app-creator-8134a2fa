ALTER TABLE public.planipret_ai_provider_usage
  ADD COLUMN IF NOT EXISTS input_tokens integer,
  ADD COLUMN IF NOT EXISTS output_tokens integer,
  ADD COLUMN IF NOT EXISTS cache_read_tokens integer,
  ADD COLUMN IF NOT EXISTS cache_write_tokens integer,
  ADD COLUMN IF NOT EXISTS label text;