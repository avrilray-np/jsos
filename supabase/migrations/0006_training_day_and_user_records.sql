begin;

alter table public.vocabulary
add column source_type text not null default 'summary'
  check (source_type in ('summary', 'user_record')),
add column source_task_id uuid references public.tasks(id) on delete cascade;

alter table public.sentences
alter column session_id drop not null,
add column source_type text not null default 'summary'
  check (source_type in ('summary', 'user_record')),
add column source_task_id uuid references public.tasks(id) on delete cascade;

create index vocabulary_source_task_idx
on public.vocabulary(source_task_id)
where source_task_id is not null;

create index sentences_source_task_idx
on public.sentences(source_task_id)
where source_task_id is not null;

create or replace function public.add_jsos_user_record(
  p_task_id uuid,
  p_kind text,
  p_value text,
  p_reading text default null,
  p_meaning_zh text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_task record;
  v_vocabulary record;
  v_sentence record;
  v_value text := btrim(coalesce(p_value, ''));
  v_reading text := btrim(coalesce(p_reading, ''));
  v_meaning text := btrim(coalesce(p_meaning_zh, ''));
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  select t.id, t.plan_run_id
  into v_task
  from public.tasks t
  join public.plan_runs p on p.id = t.plan_run_id
  where t.id = p_task_id
    and t.user_id = v_user_id
    and p.user_id = v_user_id
    and p.status = 'active';

  if not found then
    raise exception 'task not found in active plan';
  end if;

  if v_value = '' or char_length(v_value) > 200 then
    raise exception 'value is required and must be at most 200 characters';
  end if;

  if v_meaning = '' or char_length(v_meaning) > 300 then
    raise exception 'meaning is required and must be at most 300 characters';
  end if;

  if p_kind = 'vocabulary' then
    if v_reading = '' or char_length(v_reading) > 200 then
      raise exception 'reading is required and must be at most 200 characters';
    end if;

    insert into public.vocabulary (
      user_id, plan_run_id, word, reading, meaning_zh,
      status, priority, source_type, source_task_id
    ) values (
      v_user_id, v_task.plan_run_id, v_value, v_reading, v_meaning,
      'new', 'medium', 'user_record', v_task.id
    )
    on conflict (plan_run_id, word, reading) do update
    set meaning_zh = excluded.meaning_zh,
        source_type = 'user_record',
        source_task_id = excluded.source_task_id
    returning id, word, reading, meaning_zh, status, source_type, source_task_id
    into v_vocabulary;

    return jsonb_build_object(
      'kind', 'vocabulary',
      'id', v_vocabulary.id,
      'word', v_vocabulary.word,
      'reading', v_vocabulary.reading,
      'meaningZh', v_vocabulary.meaning_zh,
      'status', v_vocabulary.status,
      'sourceType', v_vocabulary.source_type,
      'sourceTaskId', v_vocabulary.source_task_id
    );
  elsif p_kind = 'sentence' then
    insert into public.sentences (
      user_id, plan_run_id, session_id, original, is_approximate,
      corrected, meaning_zh, category, explanation_zh,
      repeat_count, status, priority, source_type, source_task_id
    ) values (
      v_user_id, v_task.plan_run_id, null, v_value, false,
      v_value, v_meaning, 'user_record', null,
      1, 'learning', 'medium', 'user_record', v_task.id
    )
    returning id, original, corrected, meaning_zh, status, source_type, source_task_id
    into v_sentence;

    return jsonb_build_object(
      'kind', 'sentence',
      'id', v_sentence.id,
      'original', v_sentence.original,
      'corrected', v_sentence.corrected,
      'meaningZh', v_sentence.meaning_zh,
      'status', v_sentence.status,
      'sourceType', v_sentence.source_type,
      'sourceTaskId', v_sentence.source_task_id
    );
  else
    raise exception 'unsupported record kind';
  end if;
end;
$$;

revoke all on function public.add_jsos_user_record(uuid, text, text, text, text)
from public, anon;
grant execute on function public.add_jsos_user_record(uuid, text, text, text, text)
to authenticated;

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
  v_training_today date := ((now() at time zone 'Asia/Shanghai') - interval '1 hour')::date;
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
    user_id, plan_run_id, template_id, day_number, topic,
    task_type, difficulty, content, status, scheduled_for
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
      when p_starts_on + (template.original_order - 1) = v_training_today
        then 'active'::public.task_status
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
    user_id, plan_run_id, calendar_date, task_id, state
  )
  select v_user_id, v_plan_run_id, scheduled_for, id, 'scheduled'
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

commit;
