begin;

create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.run_jsos_daily_rollover(
  p_today date default ((now() at time zone 'Asia/Shanghai')::date)
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan record;
  v_task_id uuid;
  v_missed_date date;
  v_plan_deferred integer;
  v_total_deferred integer := 0;
begin
  if p_today is null then
    raise exception 'today is required';
  end if;

  for v_plan in
    select id, user_id
    from public.plan_runs
    where status = 'active'
    order by created_at
  loop
    perform pg_advisory_xact_lock(hashtext(v_plan.id::text));
    v_plan_deferred := 0;

    loop
      select id, scheduled_for
      into v_task_id, v_missed_date
      from public.tasks
      where plan_run_id = v_plan.id
        and status <> 'completed'
        and scheduled_for < p_today
      order by scheduled_for, day_number
      limit 1
      for update;

      exit when not found;

      update public.calendar_entries
      set state = 'deferred',
          original_task_id = v_task_id,
          task_id = null,
          note = '未在计划日期完成，任务已自动顺延'
      where plan_run_id = v_plan.id
        and calendar_date = v_missed_date;

      if not found then
        insert into public.calendar_entries (
          user_id, plan_run_id, calendar_date, task_id, state, original_task_id, note
        ) values (
          v_plan.user_id, v_plan.id, v_missed_date, null, 'deferred', v_task_id,
          '未在计划日期完成，任务已自动顺延'
        );
      end if;

      -- Move future calendar rows through a temporary date range so the
      -- per-plan unique date constraint can never collide mid-update.
      update public.calendar_entries
      set calendar_date = calendar_date + 10000
      where plan_run_id = v_plan.id
        and calendar_date > v_missed_date
        and state in ('scheduled', 'rest');

      update public.calendar_entries
      set calendar_date = calendar_date - 9999
      where plan_run_id = v_plan.id
        and calendar_date > v_missed_date + 5000;

      update public.tasks
      set scheduled_for = scheduled_for + 1,
          status = 'scheduled',
          updated_at = now()
      where plan_run_id = v_plan.id
        and status <> 'completed'
        and scheduled_for >= v_missed_date;

      insert into public.calendar_entries (
        user_id, plan_run_id, calendar_date, task_id, state
      ) values (
        v_plan.user_id, v_plan.id, v_missed_date + 1, v_task_id, 'scheduled'
      );

      v_plan_deferred := v_plan_deferred + 1;
      v_total_deferred := v_total_deferred + 1;
    end loop;

    update public.tasks
    set status = case when scheduled_for = p_today then 'active'::public.task_status else 'scheduled'::public.task_status end,
        updated_at = now()
    where plan_run_id = v_plan.id
      and status <> 'completed';

    insert into public.job_runs (
      idempotency_key, job_type, plan_run_id, scheduled_for,
      started_at, finished_at, status, result
    ) values (
      'daily-rollover:' || v_plan.id::text || ':' || p_today::text,
      'daily-rollover',
      v_plan.id,
      ((p_today::timestamp + time '01:00') at time zone 'Asia/Shanghai'),
      now(), now(), 'succeeded',
      jsonb_build_object('today', p_today, 'deferredCount', v_plan_deferred)
    )
    on conflict (idempotency_key) do update
    set finished_at = excluded.finished_at,
        status = 'succeeded',
        result = excluded.result;
  end loop;

  return jsonb_build_object('today', p_today, 'deferredCount', v_total_deferred);
end;
$$;

revoke all on function public.run_jsos_daily_rollover(date) from public, anon, authenticated;
grant execute on function public.run_jsos_daily_rollover(date) to service_role;

create or replace function public.import_jsos_summary(p_summary jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_task_id uuid;
  v_task record;
  v_session_id uuid;
  v_item jsonb;
  v_vocabulary_id uuid;
  v_communication integer;
  v_fluency integer;
  v_pronunciation integer;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  if p_summary is null
    or p_summary ->> 'schemaVersion' <> '1.0'
    or p_summary ->> 'rubricVersion' <> '1.0' then
    raise exception 'unsupported summary version';
  end if;

  if coalesce((p_summary #>> '{session,completed}')::boolean, false) is not true then
    raise exception 'session is not completed';
  end if;

  begin
    v_task_id := (p_summary #>> '{task,taskId}')::uuid;
  exception when others then
    raise exception 'invalid task id';
  end;

  select t.id, t.user_id, t.plan_run_id, t.scheduled_for, t.topic
  into v_task
  from public.tasks t
  join public.plan_runs p on p.id = t.plan_run_id
  where t.id = v_task_id
    and t.user_id = v_user_id
    and p.status = 'active';

  if not found then
    raise exception 'task does not belong to the active plan';
  end if;

  v_communication := nullif(p_summary #>> '{scores,communication,score}', '')::integer;
  v_fluency := nullif(p_summary #>> '{scores,fluency,score}', '')::integer;
  v_pronunciation := nullif(p_summary #>> '{scores,pronunciation,score}', '')::integer;

  if (v_communication is not null and v_communication not between 1 and 5)
    or (v_fluency is not null and v_fluency not between 1 and 5)
    or (v_pronunciation is not null and v_pronunciation not between 1 and 5) then
    raise exception 'scores must be between 1 and 5 or null';
  end if;

  insert into public.training_sessions (
    user_id, plan_run_id, task_id, schema_version, rubric_version,
    duration_minutes, communication_score, fluency_score,
    pronunciation_score, summary_zh, needs_reinforcement,
    recommendation, raw_summary
  ) values (
    v_user_id,
    v_task.plan_run_id,
    v_task_id,
    p_summary ->> 'schemaVersion',
    p_summary ->> 'rubricVersion',
    nullif(p_summary #>> '{session,durationMinutes}', '')::integer,
    v_communication,
    v_fluency,
    v_pronunciation,
    p_summary ->> 'summaryZh',
    coalesce((p_summary #>> '{recommendation,needsReinforcement}')::boolean, false),
    coalesce(p_summary -> 'recommendation', '{}'::jsonb),
    p_summary
  )
  on conflict (user_id, task_id) do update
  set schema_version = excluded.schema_version,
      rubric_version = excluded.rubric_version,
      duration_minutes = excluded.duration_minutes,
      communication_score = excluded.communication_score,
      fluency_score = excluded.fluency_score,
      pronunciation_score = excluded.pronunciation_score,
      summary_zh = excluded.summary_zh,
      needs_reinforcement = excluded.needs_reinforcement,
      recommendation = excluded.recommendation,
      raw_summary = excluded.raw_summary,
      imported_at = now()
  returning id into v_session_id;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_summary -> 'newWords', '[]'::jsonb))
  loop
    if coalesce(v_item ->> 'word', '') <> '' then
      insert into public.vocabulary (
        user_id, plan_run_id, word, reading, meaning_zh,
        example_ja, example_zh, status, priority
      ) values (
        v_user_id,
        v_task.plan_run_id,
        v_item ->> 'word',
        coalesce(v_item ->> 'reading', ''),
        coalesce(v_item ->> 'meaningZh', ''),
        v_item ->> 'exampleJa',
        v_item ->> 'exampleZh',
        'new',
        coalesce(nullif(v_item ->> 'priority', ''), 'medium')
      )
      on conflict (plan_run_id, word, reading) do update
      set meaning_zh = excluded.meaning_zh,
          example_ja = excluded.example_ja,
          example_zh = excluded.example_zh,
          priority = excluded.priority
      returning id into v_vocabulary_id;

      insert into public.vocabulary_sources (vocabulary_id, session_id)
      values (v_vocabulary_id, v_session_id)
      on conflict do nothing;
    end if;
  end loop;

  delete from public.sentences where session_id = v_session_id;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_summary -> 'sentences', '[]'::jsonb))
  loop
    if coalesce(v_item ->> 'original', '') <> '' and coalesce(v_item ->> 'corrected', '') <> '' then
      insert into public.sentences (
        user_id, plan_run_id, session_id, original, is_approximate,
        corrected, meaning_zh, category, explanation_zh,
        repeat_count, status, priority
      ) values (
        v_user_id,
        v_task.plan_run_id,
        v_session_id,
        v_item ->> 'original',
        coalesce((v_item ->> 'isApproximate')::boolean, false),
        v_item ->> 'corrected',
        v_item ->> 'meaningZh',
        coalesce(nullif(v_item ->> 'category', ''), 'expression'),
        v_item ->> 'explanationZh',
        coalesce(nullif(v_item ->> 'repeatCount', '')::integer, 1),
        'learning',
        coalesce(nullif(v_item ->> 'priority', ''), 'medium')
      );
    end if;
  end loop;

  update public.tasks
  set status = 'completed', completed_at = now(), updated_at = now()
  where id = v_task_id and user_id = v_user_id;

  update public.calendar_entries
  set state = 'completed'
  where plan_run_id = v_task.plan_run_id and task_id = v_task_id;

  return jsonb_build_object(
    'taskId', v_task_id,
    'sessionId', v_session_id,
    'completed', true,
    'needsReinforcement', coalesce((p_summary #>> '{recommendation,needsReinforcement}')::boolean, false)
  );
end;
$$;

revoke all on function public.import_jsos_summary(jsonb) from public, anon;
grant execute on function public.import_jsos_summary(jsonb) to authenticated;

select cron.schedule(
  'jsos-daily-rollover-beijing-0100',
  '0 17 * * *',
  $$select public.run_jsos_daily_rollover((now() at time zone 'Asia/Shanghai')::date);$$
);

commit;
