CREATE TABLE IF NOT EXISTS public.planipret_task_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  maestro_broker_id text,
  source text not null default 'sweeper',
  ok boolean not null default false,
  tasks_count integer not null default 0,
  result_source text,
  http_status integer,
  error text,
  duration_ms integer,
  started_at timestamptz not null default now(),
  finished_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS planipret_task_sync_runs_user_idx
  ON public.planipret_task_sync_runs (user_id, finished_at desc);

GRANT SELECT ON public.planipret_task_sync_runs TO authenticated;
GRANT ALL ON public.planipret_task_sync_runs TO service_role;

ALTER TABLE public.planipret_task_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own task sync history" ON public.planipret_task_sync_runs;
CREATE POLICY "own task sync history"
  ON public.planipret_task_sync_runs FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_planipret_admin(auth.uid()));

DROP POLICY IF EXISTS "service writes task sync history" ON public.planipret_task_sync_runs;
CREATE POLICY "service writes task sync history"
  ON public.planipret_task_sync_runs FOR ALL TO service_role
  USING (true) WITH CHECK (true);