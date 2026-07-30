create extension if not exists pgcrypto;

create type public.task_status as enum ('draft','scheduled','active','completed','deferred','generation_failed');
create type public.task_type as enum ('core','reinforcement','review','assessment','comprehensive');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  timezone text not null default 'Asia/Shanghai',
  current_stage integer not null default 1,
  plan_started_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.curriculum_templates (
  id uuid primary key default gen_random_uuid(),
  stable_key text not null unique,
  original_order integer not null unique,
  stage integer not null,
  topic text not null,
  scenario jsonb not null default '{}'::jsonb,
  target_patterns jsonb not null default '[]'::jsonb,
  base_prompt text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  template_id uuid references public.curriculum_templates(id),
  parent_task_id uuid references public.tasks(id),
  day_number integer not null,
  topic text not null,
  task_type public.task_type not null,
  difficulty text not null default 'basic',
  content jsonb not null default '{}'::jsonb,
  status public.task_status not null default 'draft',
  scheduled_for date,
  generation_version integer not null default 1,
  generation_attempts integer not null default 0,
  generation_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, day_number)
);

create table public.calendar_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  calendar_date date not null,
  task_id uuid references public.tasks(id),
  state text not null check (state in ('empty','scheduled','completed','deferred','rest')),
  original_task_id uuid references public.tasks(id),
  note text,
  created_at timestamptz not null default now(),
  unique(user_id, calendar_date)
);

create table public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  task_id uuid not null references public.tasks(id),
  schema_version text not null,
  rubric_version text not null,
  duration_minutes integer,
  communication_score integer check (communication_score between 1 and 5),
  fluency_score integer check (fluency_score between 1 and 5),
  pronunciation_score integer check (pronunciation_score between 1 and 5),
  summary_zh text,
  needs_reinforcement boolean not null default false,
  recommendation jsonb not null default '{}'::jsonb,
  raw_summary jsonb not null,
  imported_at timestamptz not null default now(),
  unique(user_id, task_id)
);

create table public.vocabulary (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  word text not null,
  reading text,
  meaning_zh text not null,
  example_ja text,
  example_zh text,
  status text not null default 'new' check (status in ('new','learning','known')),
  appearance_count integer not null default 1,
  anki_enabled boolean not null default true,
  priority text not null default 'medium',
  first_seen_at timestamptz not null default now(),
  unique(user_id, word, reading)
);

create table public.vocabulary_sources (
  vocabulary_id uuid not null references public.vocabulary(id) on delete cascade,
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  primary key(vocabulary_id, session_id)
);

create table public.sentences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  original text not null,
  is_approximate boolean not null default false,
  corrected text not null,
  meaning_zh text,
  category text not null,
  explanation_zh text,
  repeat_count integer not null default 1,
  status text not null default 'learning' check (status in ('learning','mastered')),
  priority text not null default 'medium',
  created_at timestamptz not null default now()
);

create table public.daily_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  check_date date not null,
  anki boolean not null default false,
  shadowing boolean not null default false,
  monologue boolean not null default false,
  writing boolean not null default false,
  unique(user_id, check_date)
);

create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  job_type text not null,
  scheduled_for timestamptz not null,
  started_at timestamptz,
  finished_at timestamptz,
  status text not null check (status in ('pending','running','succeeded','failed','recovered')),
  retry_count integer not null default 0,
  error_message text,
  result jsonb not null default '{}'::jsonb
);

alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.calendar_entries enable row level security;
alter table public.training_sessions enable row level security;
alter table public.vocabulary enable row level security;
alter table public.vocabulary_sources enable row level security;
alter table public.sentences enable row level security;
alter table public.daily_checkins enable row level security;

create policy "own profile" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "own tasks" on public.tasks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own calendar" on public.calendar_entries for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own sessions" on public.training_sessions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own vocabulary" on public.vocabulary for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own sentences" on public.sentences for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own checkins" on public.daily_checkins for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index tasks_user_schedule_idx on public.tasks(user_id, scheduled_for, status);
create index calendar_user_date_idx on public.calendar_entries(user_id, calendar_date);
create index sessions_user_imported_idx on public.training_sessions(user_id, imported_at desc);
create index vocabulary_user_status_idx on public.vocabulary(user_id, status);
create index sentences_user_status_idx on public.sentences(user_id, status);
