-- DRAFT ONLY: apply through the managed migration tool on explicit authorization,
-- before deploying the handoff functions. No native changes are included.
create table public.planipret_ava_sms_handoff_state (
  user_id uuid primary key, sessions jsonb not null default '{}',
  taken_over jsonb not null default '{}', observations jsonb not null default '{}',
  summaries jsonb not null default '{}', queue jsonb not null default '{}', busy_job uuid,
  updated_at timestamptz not null default now()
);
grant all on public.planipret_ava_sms_handoff_state to service_role;
alter table public.planipret_ava_sms_handoff_state enable row level security;
-- No browser access: all reads and mutations use authenticated edge actions.
create or replace function public.pp_ava_sms_handoff(p_user uuid, p_op text, p_args jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.planipret_ava_sms_handoff_state; peer text := p_args->>'peer';
  active boolean; entry jsonb; k text; claimed_id uuid;
begin
  if p_user <> 'a7df1872-f25a-4925-b763-a573e7452462'::uuid then raise exception 'pilot_only'; end if;
  insert into public.planipret_ava_sms_handoff_state(user_id) values(p_user) on conflict do nothing;
  select * into s from public.planipret_ava_sms_handoff_state where user_id=p_user for update;
  if p_op='presence' then
    if (p_args->>'active')::boolean then s.sessions := s.sessions || jsonb_build_object(p_args->>'session_id', true);
    else s.sessions := s.sessions - (p_args->>'session_id'); end if;
  elsif p_op='takeover' then
    if peer is null then raise exception 'peer_required'; end if;
    if p_args ? 'source_id' then
      if s.observations ? (p_args->>'source_id') then return jsonb_build_object('duplicate',true); end if;
      s.observations := s.observations || jsonb_build_object(p_args->>'source_id',true);
    end if;
    s.taken_over := s.taken_over || jsonb_build_object(peer,true);
  elsif p_op='resume' then
    s.taken_over := s.taken_over - peer;
  elsif p_op='save_summary' then
    entry := coalesce(s.summaries->peer,'{}');
    if entry->>'job_id' = p_args->>'job_id' then return jsonb_build_object('duplicate',true); end if;
    s.summaries := s.summaries || jsonb_build_object(peer,jsonb_build_object(
      'peer',peer,'job_id',p_args->>'job_id','summary',p_args->>'summary','read',false,'greeted',false,'notified',false));
  elsif p_op in ('read','greet','notify_claim') then
    entry := s.summaries->peer;
    if entry is null or entry->>'job_id' <> p_args->>'job_id' then return jsonb_build_object('claimed',false); end if;
    k := case p_op when 'read' then 'read' when 'greet' then 'greeted' else 'notified' end;
    if coalesce((entry->>k)::boolean,false) then return jsonb_build_object('claimed',false); end if;
    s.summaries := s.summaries || jsonb_build_object(peer,entry || jsonb_build_object(k,true));
  elsif p_op='queue' then
    s.queue := s.queue || jsonb_build_object(p_args->>'message_id',peer);
  elsif p_op='dequeue' then
    s.queue := s.queue - (p_args->>'message_id');
  elsif p_op='release' then
    if s.busy_job::text = p_args->>'job_id' then s.busy_job := null; end if;
  elsif p_op not in ('status','check','begin','queue_list','claim') then raise exception 'unknown_operation';
  end if;
  active := s.sessions <> '{}'::jsonb;
  if p_op='claim' then
    if active or s.taken_over ? peer or s.busy_job::text is distinct from p_args->>'job_id' then return jsonb_build_object('claimed',false); end if;
    k := case p_args->>'kind' when 'reply' then 'reply_claimed_at' when 'calendar' then 'calendar_claimed_at' else null end;
    if k is null then raise exception 'invalid_claim'; end if;
    execute format('update public.planipret_ava_sms_jobs set %I=now() where id=$1 and user_id=$2 and peer=$3 and status=$4 and %I is null returning id',k,k)
      into claimed_id using (p_args->>'job_id')::uuid,p_user,peer,p_args->>'status';
    return jsonb_build_object('claimed',claimed_id is not null);
  end if;
  if p_op='begin' then
    if active or s.taken_over ? peer or s.busy_job is not null then
      return jsonb_build_object('allowed',false,'paused',true);
    end if;
    s.busy_job := (p_args->>'job_id')::uuid;
  end if;
  update public.planipret_ava_sms_handoff_state set sessions=s.sessions,taken_over=s.taken_over,
    observations=s.observations,summaries=s.summaries,queue=s.queue,busy_job=s.busy_job,updated_at=now() where user_id=p_user;
  return jsonb_build_object('allowed',true,'claimed',true,'online',active,
    'paused',active or coalesce(s.taken_over ? peer,false) or (s.busy_job is not null and s.busy_job::text is distinct from p_args->>'job_id'),
    'taking_over',s.busy_job is not null,'summaries',s.summaries,'taken_over',s.taken_over,'queue',s.queue);
end; $$;
revoke all on function public.pp_ava_sms_handoff(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.pp_ava_sms_handoff(uuid,text,jsonb) to service_role;