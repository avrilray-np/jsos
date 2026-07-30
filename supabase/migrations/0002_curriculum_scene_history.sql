create table public.curriculum_scenario_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  template_id uuid not null references public.curriculum_templates(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  scenario_key text not null,
  scenario_title text not null,
  completed boolean not null default false,
  practiced_at timestamptz not null default now(),
  unique(task_id, scenario_key)
);

alter table public.curriculum_scenario_attempts enable row level security;

create policy "own curriculum scene attempts"
on public.curriculum_scenario_attempts
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index curriculum_scene_attempts_user_template_idx
on public.curriculum_scenario_attempts(user_id, template_id, practiced_at desc);
