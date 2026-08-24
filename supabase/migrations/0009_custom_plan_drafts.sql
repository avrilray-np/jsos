begin;

create type public.plan_draft_status as enum (
  'generating_topics',
  'topics_ready',
  'topics_confirmed',
  'active',
  'generation_failed',
  'discarded'
);

create type public.plan_topic_status as enum ('pending', 'generating', 'completed', 'failed');
create type public.plan_generation_status as enum ('pending', 'running', 'succeeded', 'failed');

create table public.plan_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  learning_goal text not null check (char_length(btrim(learning_goal)) between 1 and 1000),
  day_count integer not null check (day_count between 1 and 90),
  status public.plan_draft_status not null default 'generating_topics',
  topic_attempt_count integer not null default 1 check (topic_attempt_count between 1 and 20),
  topic_generation_started_at timestamptz not null default now(),
  error_code text,
  confirmed_at timestamptz,
  plan_run_id uuid unique references public.plan_runs(id) on delete set null,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index plan_drafts_one_open_per_user_idx
on public.plan_drafts(user_id)
where status in ('generating_topics', 'topics_ready', 'topics_confirmed', 'generation_failed');

create index plan_drafts_user_created_idx on public.plan_drafts(user_id, created_at desc);

create table public.plan_topics (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.plan_drafts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  day_number integer not null check (day_number > 0),
  topic text,
  status public.plan_topic_status not null default 'pending',
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(draft_id, day_number),
  check (topic is null or char_length(btrim(topic)) between 1 and 120)
);

create index plan_topics_draft_day_idx on public.plan_topics(draft_id, day_number);

create table public.plan_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.plan_drafts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  day_number integer,
  job_type text not null check (job_type in ('topics', 'daily_content')),
  status public.plan_generation_status not null default 'pending',
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  idempotency_key text not null unique,
  error_code text,
  error_message text,
  result jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((job_type = 'topics' and day_number is null) or (job_type = 'daily_content' and day_number is not null))
);

create index plan_generation_jobs_draft_status_idx
on public.plan_generation_jobs(draft_id, status, day_number);

alter table public.plan_drafts enable row level security;
alter table public.plan_topics enable row level security;
alter table public.plan_generation_jobs enable row level security;

create policy "read own plan drafts"
on public.plan_drafts for select to authenticated
using ((select auth.uid()) = user_id);

create policy "read own plan topics"
on public.plan_topics for select to authenticated
using ((select auth.uid()) = user_id);

create policy "own plan generation jobs"
on public.plan_generation_jobs for select to authenticated
using ((select auth.uid()) = user_id);

grant select on public.plan_drafts to authenticated;
grant select on public.plan_topics to authenticated;
grant select on public.plan_generation_jobs to authenticated;
grant all on public.plan_drafts, public.plan_topics, public.plan_generation_jobs to service_role;

create or replace function public.create_jsos_plan_draft(
  p_learning_goal text,
  p_day_count integer
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_draft_id uuid;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  if char_length(btrim(coalesce(p_learning_goal, ''))) not between 1 and 1000 then raise exception 'invalid learning goal'; end if;
  if p_day_count not between 1 and 90 then raise exception 'invalid day count'; end if;

  perform pg_advisory_xact_lock(hashtext('plan-draft:' || v_user_id::text));

  update public.plan_drafts
  set status = 'discarded', updated_at = now()
  where user_id = v_user_id
    and status in ('generating_topics', 'topics_ready', 'topics_confirmed', 'generation_failed');

  insert into public.plan_drafts (user_id, learning_goal, day_count)
  values (v_user_id, btrim(p_learning_goal), p_day_count)
  returning id into v_draft_id;

  insert into public.plan_topics (draft_id, user_id, day_number)
  select v_draft_id, v_user_id, generate_series(1, p_day_count);

  insert into public.plan_generation_jobs (
    draft_id, user_id, job_type, status, attempt_count, idempotency_key, started_at
  ) values (
    v_draft_id, v_user_id, 'topics', 'pending', 1, 'topics:' || v_draft_id::text || ':1', null
  );

  return v_draft_id;
end;
$$;

create or replace function public.retry_jsos_plan_topics(p_draft_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_attempt integer;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;

  update public.plan_drafts
  set status = 'generating_topics',
      topic_attempt_count = topic_attempt_count + 1,
      topic_generation_started_at = now(),
      error_code = null,
      updated_at = now()
  where id = p_draft_id and user_id = v_user_id
    and status in ('generating_topics', 'generation_failed')
  returning topic_attempt_count into v_attempt;

  if v_attempt is null then raise exception 'draft cannot retry'; end if;

  update public.plan_topics
  set topic = null, status = 'pending', error_code = null, updated_at = now()
  where draft_id = p_draft_id and user_id = v_user_id;

  insert into public.plan_generation_jobs (
    draft_id, user_id, job_type, status, attempt_count, idempotency_key, started_at
  ) values (
    p_draft_id, v_user_id, 'topics', 'pending', v_attempt,
    'topics:' || p_draft_id::text || ':' || v_attempt::text, null
  ) on conflict (idempotency_key) do nothing;

  return v_attempt;
end;
$$;

create or replace function public.claim_jsos_topic_generation(p_draft_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_attempt integer;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;

  select topic_attempt_count into v_attempt
  from public.plan_drafts
  where id = p_draft_id and user_id = v_user_id and status = 'generating_topics';

  if v_attempt is null then return false; end if;

  update public.plan_generation_jobs
  set status = 'running', started_at = now(), updated_at = now()
  where draft_id = p_draft_id and user_id = v_user_id
    and job_type = 'topics' and attempt_count = v_attempt and status = 'pending';

  return found;
end;
$$;

create or replace function public.complete_jsos_plan_topics(
  p_draft_id uuid,
  p_topics jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_day_count integer;
  v_attempt integer;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;

  select day_count, topic_attempt_count into v_day_count, v_attempt
  from public.plan_drafts
  where id = p_draft_id and user_id = v_user_id and status = 'generating_topics'
  for update;

  if v_day_count is null then raise exception 'draft not generating'; end if;
  if jsonb_typeof(p_topics) <> 'array' or jsonb_array_length(p_topics) <> v_day_count then raise exception 'invalid topic count'; end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_topics) value
    where char_length(btrim(value)) not between 1 and 120
  ) then raise exception 'invalid topic'; end if;

  update public.plan_topics topic_row
  set topic = btrim(source.value), status = 'completed', error_code = null, updated_at = now()
  from (
    select ordinality::integer as day_number, value
    from jsonb_array_elements_text(p_topics) with ordinality
  ) source
  where topic_row.draft_id = p_draft_id
    and topic_row.user_id = v_user_id
    and topic_row.day_number = source.day_number;

  update public.plan_drafts
  set status = 'topics_ready', error_code = null, updated_at = now()
  where id = p_draft_id and user_id = v_user_id;

  update public.plan_generation_jobs
  set status = 'succeeded', finished_at = now(), updated_at = now()
  where draft_id = p_draft_id and user_id = v_user_id
    and job_type = 'topics' and attempt_count = v_attempt;
end;
$$;

create or replace function public.fail_jsos_plan_topics(
  p_draft_id uuid,
  p_error_code text,
  p_error_message text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_attempt integer;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;

  update public.plan_drafts
  set status = 'generation_failed', error_code = left(p_error_code, 80), updated_at = now()
  where id = p_draft_id and user_id = v_user_id
    and status = 'generating_topics'
  returning topic_attempt_count into v_attempt;

  update public.plan_generation_jobs
  set status = 'failed', error_code = left(p_error_code, 80), error_message = left(p_error_message, 500),
      finished_at = now(), updated_at = now()
  where draft_id = p_draft_id and user_id = v_user_id
    and job_type = 'topics' and attempt_count = v_attempt;
end;
$$;

create or replace function public.confirm_jsos_plan_topics(p_draft_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_day_count integer;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;

  select day_count into v_day_count
  from public.plan_drafts
  where id = p_draft_id and user_id = v_user_id and status = 'topics_ready'
  for update;

  if v_day_count is null then raise exception 'draft not ready'; end if;
  if (select count(*) from public.plan_topics where draft_id = p_draft_id and status = 'completed' and topic is not null) <> v_day_count then
    raise exception 'topics incomplete';
  end if;

  update public.plan_drafts
  set status = 'topics_confirmed', confirmed_at = now(), updated_at = now()
  where id = p_draft_id;

  insert into public.plan_generation_jobs (
    draft_id, user_id, day_number, job_type, status, idempotency_key
  )
  select p_draft_id, v_user_id, day_number, 'daily_content', 'pending',
         'daily:' || p_draft_id::text || ':' || day_number::text
  from public.plan_topics
  where draft_id = p_draft_id
  on conflict (idempotency_key) do nothing;
end;
$$;

create or replace function public.update_jsos_plan_topic(
  p_draft_id uuid,
  p_day_number integer,
  p_topic text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  if char_length(btrim(coalesce(p_topic, ''))) not between 1 and 120 then raise exception 'invalid topic'; end if;

  update public.plan_topics topic_row
  set topic = btrim(p_topic), updated_at = now()
  where topic_row.draft_id = p_draft_id
    and topic_row.user_id = v_user_id
    and topic_row.day_number = p_day_number
    and topic_row.status = 'completed'
    and exists (
      select 1 from public.plan_drafts draft
      where draft.id = p_draft_id
        and draft.user_id = v_user_id
        and draft.status = 'topics_ready'
    );

  if not found then raise exception 'topic cannot update'; end if;
end;
$$;

create or replace function public.activate_jsos_plan_draft(
  p_draft_id uuid,
  p_kind public.plan_run_kind,
  p_starts_on date
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_plan_run_id uuid;
  v_day_count integer;
  v_training_today date := ((now() at time zone 'Asia/Shanghai') - interval '1 hour')::date;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  if p_starts_on is null then raise exception 'starts_on is required'; end if;
  if p_starts_on < (now() at time zone 'Asia/Shanghai')::date then raise exception 'starts_on cannot be in the past'; end if;

  perform pg_advisory_xact_lock(hashtext('activate-draft:' || v_user_id::text));

  select day_count into v_day_count
  from public.plan_drafts
  where id = p_draft_id and user_id = v_user_id and status = 'topics_confirmed'
  for update;

  if v_day_count is null then raise exception 'draft not confirmed'; end if;

  update public.plan_runs
  set status = 'archived', archived_at = now()
  where user_id = v_user_id and status = 'active';

  insert into public.plan_runs (user_id, kind, status, starts_on)
  values (v_user_id, p_kind, 'active', p_starts_on)
  returning id into v_plan_run_id;

  insert into public.tasks (
    user_id, plan_run_id, day_number, topic, task_type, difficulty,
    content, status, scheduled_for
  )
  select
    v_user_id, v_plan_run_id, topic_row.day_number, topic_row.topic, 'core', 'basic',
    case when generation_job.status = 'succeeded'
      then generation_job.result || jsonb_build_object('generationState', 'completed')
      else jsonb_build_object('generationState', 'pending') end,
    case when p_starts_on + (topic_row.day_number - 1) = v_training_today
      then 'active'::public.task_status else 'scheduled'::public.task_status end,
    p_starts_on + (topic_row.day_number - 1)
  from public.plan_topics topic_row
  left join public.plan_generation_jobs generation_job
    on generation_job.draft_id = topic_row.draft_id
   and generation_job.day_number = topic_row.day_number
   and generation_job.job_type = 'daily_content'
  where topic_row.draft_id = p_draft_id and topic_row.user_id = v_user_id
  order by topic_row.day_number;

  if (select count(*) from public.tasks where plan_run_id = v_plan_run_id) <> v_day_count then
    raise exception 'topic count mismatch';
  end if;

  insert into public.calendar_entries (user_id, plan_run_id, calendar_date, task_id, state)
  select v_user_id, v_plan_run_id, scheduled_for, id, 'scheduled'
  from public.tasks where plan_run_id = v_plan_run_id;

  update public.profiles
  set active_plan_run_id = v_plan_run_id, plan_started_on = p_starts_on, updated_at = now()
  where id = v_user_id;

  update public.plan_drafts
  set status = 'active', plan_run_id = v_plan_run_id, activated_at = now(), updated_at = now()
  where id = p_draft_id;

  return v_plan_run_id;
end;
$$;

create or replace function public.claim_next_jsos_daily_generation_job()
returns table (
  job_id uuid,
  draft_id uuid,
  day_number integer,
  learning_goal text,
  topic text,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.role()) <> 'service_role' then raise exception 'service role required'; end if;

  return query
  with candidate as (
    select generation_job.id
    from public.plan_generation_jobs generation_job
    where generation_job.job_type = 'daily_content'
      and generation_job.attempt_count < 3
      and (
        generation_job.status = 'pending'
        or (generation_job.status = 'running' and generation_job.started_at < now() - interval '15 minutes')
      )
    order by generation_job.created_at, generation_job.day_number
    for update skip locked
    limit 1
  ), claimed as (
    update public.plan_generation_jobs generation_job
    set status = 'running',
        attempt_count = generation_job.attempt_count + 1,
        started_at = now(),
        finished_at = null,
        error_code = null,
        error_message = null,
        updated_at = now()
    from candidate
    where generation_job.id = candidate.id
    returning generation_job.id, generation_job.draft_id, generation_job.day_number, generation_job.attempt_count
  )
  select claimed.id, claimed.draft_id, claimed.day_number,
         draft.learning_goal, topic_row.topic, claimed.attempt_count
  from claimed
  join public.plan_drafts draft on draft.id = claimed.draft_id
  join public.plan_topics topic_row
    on topic_row.draft_id = claimed.draft_id and topic_row.day_number = claimed.day_number;
end;
$$;

create or replace function public.complete_jsos_daily_generation_job(
  p_job_id uuid,
  p_result jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_draft_id uuid;
  v_day_number integer;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'service role required'; end if;
  if jsonb_typeof(p_result) <> 'object' then raise exception 'invalid generation result'; end if;

  update public.plan_generation_jobs
  set status = 'succeeded', result = p_result, error_code = null, error_message = null,
      finished_at = now(), updated_at = now()
  where id = p_job_id and job_type = 'daily_content' and status = 'running'
  returning draft_id, day_number into v_draft_id, v_day_number;

  if v_draft_id is null then raise exception 'generation job not running'; end if;

  update public.tasks task
  set content = p_result || jsonb_build_object('generationState', 'completed'),
      generation_error = null,
      generation_attempts = (
        select attempt_count from public.plan_generation_jobs where id = p_job_id
      ),
      updated_at = now()
  where task.plan_run_id = (select plan_run_id from public.plan_drafts where id = v_draft_id)
    and task.day_number = v_day_number;
end;
$$;

create or replace function public.fail_jsos_daily_generation_job(
  p_job_id uuid,
  p_error_code text,
  p_error_message text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_draft_id uuid;
  v_day_number integer;
  v_final boolean;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'service role required'; end if;

  update public.plan_generation_jobs
  set status = case when attempt_count >= 3 then 'failed'::public.plan_generation_status else 'pending'::public.plan_generation_status end,
      error_code = left(p_error_code, 80),
      error_message = left(p_error_message, 500),
      finished_at = now(),
      updated_at = now()
  where id = p_job_id and job_type = 'daily_content' and status = 'running'
  returning draft_id, day_number, (status = 'failed') into v_draft_id, v_day_number, v_final;

  if v_draft_id is null then raise exception 'generation job not running'; end if;

  if v_final then
    update public.tasks task
    set content = coalesce(task.content, '{}'::jsonb) || jsonb_build_object(
          'generationState', 'failed',
          'generationErrorCode', left(p_error_code, 80),
          'manualRetryCount', coalesce((task.content ->> 'manualRetryCount')::integer, 0)
        ),
        generation_error = left(p_error_message, 500),
        generation_attempts = 3,
        updated_at = now()
    where task.plan_run_id = (select plan_run_id from public.plan_drafts where id = v_draft_id)
      and task.day_number = v_day_number;
  end if;

  return v_final;
end;
$$;

create or replace function public.retry_jsos_daily_generation(p_task_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_draft_id uuid;
  v_day_number integer;
  v_retry_count integer;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;

  select draft.id, task.day_number,
         coalesce((task.content ->> 'manualRetryCount')::integer, 0) + 1
  into v_draft_id, v_day_number, v_retry_count
  from public.tasks task
  join public.plan_runs plan_run on plan_run.id = task.plan_run_id
  join public.plan_drafts draft on draft.plan_run_id = plan_run.id
  where task.id = p_task_id and task.user_id = v_user_id
    and task.content ->> 'generationState' = 'failed'
  for update of task;

  if v_draft_id is null then raise exception 'task cannot retry'; end if;

  update public.plan_generation_jobs
  set status = 'pending', attempt_count = 0, error_code = null, error_message = null,
      started_at = null, finished_at = null, updated_at = now()
  where draft_id = v_draft_id and day_number = v_day_number and job_type = 'daily_content';

  update public.tasks
  set content = (content - 'generationErrorCode') || jsonb_build_object(
        'generationState', 'generating', 'manualRetryCount', v_retry_count
      ),
      generation_error = null,
      generation_attempts = 0,
      updated_at = now()
  where id = p_task_id and user_id = v_user_id;

  return v_retry_count;
end;
$$;

revoke all on function public.create_jsos_plan_draft(text, integer) from public, anon;
revoke all on function public.retry_jsos_plan_topics(uuid) from public, anon;
revoke all on function public.claim_jsos_topic_generation(uuid) from public, anon;
revoke all on function public.complete_jsos_plan_topics(uuid, jsonb) from public, anon;
revoke all on function public.fail_jsos_plan_topics(uuid, text, text) from public, anon;
revoke all on function public.confirm_jsos_plan_topics(uuid) from public, anon;
revoke all on function public.update_jsos_plan_topic(uuid, integer, text) from public, anon;
revoke all on function public.activate_jsos_plan_draft(uuid, public.plan_run_kind, date) from public, anon;
revoke all on function public.claim_next_jsos_daily_generation_job() from public, anon, authenticated;
revoke all on function public.complete_jsos_daily_generation_job(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fail_jsos_daily_generation_job(uuid, text, text) from public, anon, authenticated;
revoke all on function public.retry_jsos_daily_generation(uuid) from public, anon;

grant execute on function public.create_jsos_plan_draft(text, integer) to authenticated;
grant execute on function public.retry_jsos_plan_topics(uuid) to authenticated;
grant execute on function public.claim_jsos_topic_generation(uuid) to authenticated;
grant execute on function public.complete_jsos_plan_topics(uuid, jsonb) to authenticated;
grant execute on function public.fail_jsos_plan_topics(uuid, text, text) to authenticated;
grant execute on function public.confirm_jsos_plan_topics(uuid) to authenticated;
grant execute on function public.update_jsos_plan_topic(uuid, integer, text) to authenticated;
grant execute on function public.activate_jsos_plan_draft(uuid, public.plan_run_kind, date) to authenticated;
grant execute on function public.claim_next_jsos_daily_generation_job() to service_role;
grant execute on function public.complete_jsos_daily_generation_job(uuid, jsonb) to service_role;
grant execute on function public.fail_jsos_daily_generation_job(uuid, text, text) to service_role;
grant execute on function public.retry_jsos_daily_generation(uuid) to authenticated;

commit;
