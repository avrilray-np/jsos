begin;

create type public.plan_run_kind as enum ('trial', 'official');
create type public.plan_run_status as enum ('active', 'archived');

create table public.plan_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind public.plan_run_kind not null,
  status public.plan_run_status not null default 'active',
  starts_on date not null,
  timezone text not null default 'Asia/Shanghai' check (timezone = 'Asia/Shanghai'),
  activated_at timestamptz not null default now(),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (status = 'active' and archived_at is null)
    or (status = 'archived' and archived_at is not null)
  )
);

create unique index plan_runs_one_active_per_user_idx
on public.plan_runs(user_id)
where status = 'active';

create index plan_runs_user_created_idx
on public.plan_runs(user_id, created_at desc);

alter table public.profiles
add column active_plan_run_id uuid references public.plan_runs(id) on delete set null;

alter table public.tasks
drop constraint tasks_user_id_day_number_key,
add column plan_run_id uuid not null references public.plan_runs(id) on delete cascade,
add constraint tasks_plan_run_day_number_key unique(plan_run_id, day_number);

alter table public.calendar_entries
drop constraint calendar_entries_user_id_calendar_date_key,
add column plan_run_id uuid not null references public.plan_runs(id) on delete cascade,
add constraint calendar_entries_plan_run_date_key unique(plan_run_id, calendar_date);

alter table public.training_sessions
add column plan_run_id uuid not null references public.plan_runs(id) on delete cascade;

alter table public.vocabulary
drop constraint vocabulary_user_id_word_reading_key,
add column plan_run_id uuid not null references public.plan_runs(id) on delete cascade,
add constraint vocabulary_plan_run_word_reading_key unique(plan_run_id, word, reading);

alter table public.sentences
add column plan_run_id uuid not null references public.plan_runs(id) on delete cascade;

alter table public.daily_checkins
drop constraint daily_checkins_user_id_check_date_key,
add column plan_run_id uuid not null references public.plan_runs(id) on delete cascade,
add constraint daily_checkins_plan_run_date_key unique(plan_run_id, check_date);

alter table public.curriculum_scenario_attempts
add column plan_run_id uuid not null references public.plan_runs(id) on delete cascade;

alter table public.job_runs
add column plan_run_id uuid references public.plan_runs(id) on delete set null;

create index tasks_plan_run_schedule_idx
on public.tasks(plan_run_id, scheduled_for, status);

create index calendar_plan_run_date_idx
on public.calendar_entries(plan_run_id, calendar_date);

create index sessions_plan_run_imported_idx
on public.training_sessions(plan_run_id, imported_at desc);

create index vocabulary_plan_run_status_idx
on public.vocabulary(plan_run_id, status);

create index sentences_plan_run_status_idx
on public.sentences(plan_run_id, status);

create index checkins_plan_run_date_idx
on public.daily_checkins(plan_run_id, check_date);

alter table public.plan_runs enable row level security;
alter table public.curriculum_templates enable row level security;
alter table public.job_runs enable row level security;

drop policy if exists "own profile" on public.profiles;
drop policy if exists "own tasks" on public.tasks;
drop policy if exists "own calendar" on public.calendar_entries;
drop policy if exists "own sessions" on public.training_sessions;
drop policy if exists "own vocabulary" on public.vocabulary;
drop policy if exists "own sentences" on public.sentences;
drop policy if exists "own checkins" on public.daily_checkins;
drop policy if exists "own curriculum scene attempts" on public.curriculum_scenario_attempts;

create policy "own profile"
on public.profiles for all to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "read own plan runs"
on public.plan_runs for select to authenticated
using ((select auth.uid()) = user_id);

create policy "read enabled curriculum"
on public.curriculum_templates for select to authenticated
using (enabled = true);

create policy "own tasks"
on public.tasks for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "own calendar"
on public.calendar_entries for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "own sessions"
on public.training_sessions for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "own vocabulary"
on public.vocabulary for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "own vocabulary sources"
on public.vocabulary_sources for select to authenticated
using (
  exists (
    select 1 from public.vocabulary
    where vocabulary.id = vocabulary_sources.vocabulary_id
      and vocabulary.user_id = (select auth.uid())
  )
);

create policy "insert own vocabulary sources"
on public.vocabulary_sources for insert to authenticated
with check (
  exists (
    select 1 from public.vocabulary
    where vocabulary.id = vocabulary_sources.vocabulary_id
      and vocabulary.user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.training_sessions
    where training_sessions.id = vocabulary_sources.session_id
      and training_sessions.user_id = (select auth.uid())
  )
);

create policy "delete own vocabulary sources"
on public.vocabulary_sources for delete to authenticated
using (
  exists (
    select 1 from public.vocabulary
    where vocabulary.id = vocabulary_sources.vocabulary_id
      and vocabulary.user_id = (select auth.uid())
  )
);

create policy "own sentences"
on public.sentences for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "own checkins"
on public.daily_checkins for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "own curriculum scene attempts"
on public.curriculum_scenario_attempts for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant select on public.plan_runs to authenticated;
grant select on public.curriculum_templates to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.calendar_entries to authenticated;
grant select, insert, update, delete on public.training_sessions to authenticated;
grant select, insert, update, delete on public.vocabulary to authenticated;
grant select, insert, delete on public.vocabulary_sources to authenticated;
grant select, insert, update, delete on public.sentences to authenticated;
grant select, insert, update, delete on public.daily_checkins to authenticated;
grant select, insert, update, delete on public.curriculum_scenario_attempts to authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

create or replace function public.handle_new_jsos_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.email is not null then
    insert into public.profiles (id, email, display_name)
    values (
      new.id,
      lower(new.email),
      coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
    )
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_jsos_profile on auth.users;

create trigger on_auth_user_created_create_jsos_profile
after insert on auth.users
for each row execute function public.handle_new_jsos_user();

insert into public.profiles (id, email, display_name)
select
  id,
  lower(email),
  coalesce(raw_user_meta_data ->> 'display_name', split_part(email, '@', 1))
from auth.users
where email is not null
on conflict (id) do nothing;

create or replace function public.start_jsos_plan(
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
  v_beijing_today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  if p_starts_on is null then
    raise exception 'starts_on is required';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text));

  update public.plan_runs
  set status = 'archived',
      archived_at = now()
  where user_id = v_user_id
    and status = 'active';

  insert into public.plan_runs (user_id, kind, status, starts_on)
  values (v_user_id, p_kind, 'active', p_starts_on)
  returning id into v_plan_run_id;

  insert into public.tasks (
    user_id,
    plan_run_id,
    template_id,
    day_number,
    topic,
    task_type,
    difficulty,
    content,
    status,
    scheduled_for
  )
  select
    v_user_id,
    v_plan_run_id,
    template.id,
    template.original_order,
    template.topic,
    'core',
    'basic',
    jsonb_build_object(
      'stableKey', template.stable_key,
      'scenes', template.scenario -> 'scenes',
      'targetPatterns', template.target_patterns,
      'basePrompt', template.base_prompt
    ),
    case
      when p_starts_on + (template.original_order - 1) = v_beijing_today then 'active'::public.task_status
      else 'scheduled'::public.task_status
    end,
    p_starts_on + (template.original_order - 1)
  from public.curriculum_templates as template
  where template.enabled = true
  order by template.original_order;

  if (select count(*) from public.tasks where plan_run_id = v_plan_run_id) <> 40 then
    raise exception 'exactly 40 enabled curriculum templates are required';
  end if;

  insert into public.calendar_entries (
    user_id,
    plan_run_id,
    calendar_date,
    task_id,
    state
  )
  select
    v_user_id,
    v_plan_run_id,
    scheduled_for,
    id,
    'scheduled'
  from public.tasks
  where plan_run_id = v_plan_run_id;

  update public.profiles
  set active_plan_run_id = v_plan_run_id,
      plan_started_on = p_starts_on,
      updated_at = now()
  where id = v_user_id;

  return v_plan_run_id;
end;
$$;

revoke all on function public.start_jsos_plan(public.plan_run_kind, date) from public;
revoke all on function public.start_jsos_plan(public.plan_run_kind, date) from anon;
grant execute on function public.start_jsos_plan(public.plan_run_kind, date) to authenticated;

commit;
