create table public.planipret_commission_ai_audit (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid,
  broker_id text,
  source text not null,
  status text not null,
  ai_status text,
  summary text,
  anomalies jsonb not null default '[]'::jsonb,
  data_quality jsonb,
  headline jsonb
);
create index on public.planipret_commission_ai_audit (broker_id, created_at desc);
grant all on public.planipret_commission_ai_audit to service_role;
grant select on public.planipret_commission_ai_audit to authenticated;
alter table public.planipret_commission_ai_audit enable row level security;
create policy "pp admins read commission ai audit" on public.planipret_commission_ai_audit for select to authenticated using (public.is_planipret_admin(auth.uid()));