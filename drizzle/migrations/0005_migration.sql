create table public.planipret_commission_snapshots (
  cache_key text primary key,
  user_id uuid not null,
  request_body jsonb not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  last_accessed_at timestamptz not null default now(),
  refreshing_until timestamptz
);
create index on public.planipret_commission_snapshots (fetched_at);
alter table public.planipret_commission_snapshots enable row level security;
revoke all on public.planipret_commission_snapshots from anon, authenticated;
grant all on public.planipret_commission_snapshots to service_role;