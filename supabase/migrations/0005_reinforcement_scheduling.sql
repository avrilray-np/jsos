begin;

alter table public.training_sessions
add column reinforcement_task_id uuid references public.tasks(id) on delete set null,
add column reinforcement_scheduled_at timestamptz,
add column reinforcement_error text;

create unique index tasks_one_reinforcement_per_parent_idx
on public.tasks(parent_task_id)
where task_type = 'reinforcement';

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
  v_session record;
  v_insert_date date;
  v_insert_day integer;
  v_reinforcement_task_id uuid;
  v_plan_reinforcements integer;
  v_total_reinforcements integer := 0;
  v_plan_reinforcement_failures integer;
  v_total_reinforcement_failures integer := 0;
  v_focus jsonb;
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
    v_plan_reinforcements := 0;
    v_plan_reinforcement_failures := 0;

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

    for v_session in
      select
        s.id as session_id,
        s.recommendation,
        t.id as source_task_id,
        t.day_number as source_day_number,
        t.topic as source_topic,
        t.difficulty,
        t.content,
        t.scheduled_for as source_date
      from public.training_sessions s
      join public.tasks t on t.id = s.task_id
      where s.plan_run_id = v_plan.id
        and s.needs_reinforcement = true
        and s.reinforcement_task_id is null
      order by t.scheduled_for, s.imported_at
      for update of s
    loop
      begin
      -- "间隔 2 天" means two complete training dates remain between the
      -- source and its reinforcement: 7/31 -> 8/3.
      v_insert_date := greatest(v_session.source_date + 3, p_today);

      select day_number
      into v_insert_day
      from public.tasks
      where plan_run_id = v_plan.id
        and scheduled_for >= v_insert_date
      order by scheduled_for, day_number
      limit 1;

      if v_insert_day is null then
        select coalesce(max(day_number), 0) + 1
        into v_insert_day
        from public.tasks
        where plan_run_id = v_plan.id;
      else
        update public.tasks
        set day_number = day_number + 10000
        where plan_run_id = v_plan.id
          and day_number >= v_insert_day;

        update public.tasks
        set day_number = day_number - 9999,
            updated_at = now()
        where plan_run_id = v_plan.id
          and day_number >= v_insert_day + 5000;
      end if;

      update public.calendar_entries
      set calendar_date = calendar_date + 10000
      where plan_run_id = v_plan.id
        and calendar_date >= v_insert_date
        and state in ('scheduled', 'rest');

      update public.calendar_entries
      set calendar_date = calendar_date - 9999
      where plan_run_id = v_plan.id
        and calendar_date >= v_insert_date + 5000;

      update public.tasks
      set scheduled_for = scheduled_for + 1,
          status = case
            when scheduled_for + 1 = p_today then 'active'::public.task_status
            else 'scheduled'::public.task_status
          end,
          updated_at = now()
      where plan_run_id = v_plan.id
        and status <> 'completed'
        and scheduled_for >= v_insert_date;

      v_focus := coalesce(v_session.recommendation -> 'suggestedFocus', '[]'::jsonb);

      insert into public.tasks (
        user_id, plan_run_id, template_id, parent_task_id, day_number, topic,
        task_type, difficulty, content, status, scheduled_for
      )
      select
        v_plan.user_id,
        v_plan.id,
        source.template_id,
        source.id,
        v_insert_day,
        regexp_replace(source.topic, '\s+[0-9]+$', '') || ' 2',
        'reinforcement',
        coalesce(nullif(v_session.recommendation ->> 'suggestedDifficulty', ''), source.difficulty),
        source.content || jsonb_build_object(
          'reinforcementOfTaskId', source.id,
          'reinforcementReason', v_session.recommendation ->> 'reasonZh',
          'reinforcementFocus', v_focus,
          'targetPatterns', case
            when jsonb_array_length(v_focus) > 0 then v_focus
            else coalesce(source.content -> 'targetPatterns', '[]'::jsonb)
          end
        ),
        case when v_insert_date = p_today then 'active'::public.task_status else 'scheduled'::public.task_status end,
        v_insert_date
      from public.tasks source
      where source.id = v_session.source_task_id
      returning id into v_reinforcement_task_id;

      insert into public.calendar_entries (
        user_id, plan_run_id, calendar_date, task_id, state, note
      ) values (
        v_plan.user_id, v_plan.id, v_insert_date, v_reinforcement_task_id,
        'scheduled', '根据训练总结自动生成补强任务'
      );

      update public.training_sessions
      set reinforcement_task_id = v_reinforcement_task_id,
          reinforcement_scheduled_at = now(),
          reinforcement_error = null
      where id = v_session.session_id;

      v_plan_reinforcements := v_plan_reinforcements + 1;
      v_total_reinforcements := v_total_reinforcements + 1;
      exception when others then
        -- The block above is a subtransaction. Any partial date/day shifts are
        -- rolled back before the failure is recorded, and the next run retries.
        update public.training_sessions
        set reinforcement_error = sqlerrm
        where id = v_session.session_id;
        v_plan_reinforcement_failures := v_plan_reinforcement_failures + 1;
        v_total_reinforcement_failures := v_total_reinforcement_failures + 1;
      end;
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
      jsonb_build_object(
        'today', p_today,
        'deferredCount', v_plan_deferred,
        'reinforcementCount', v_plan_reinforcements,
        'reinforcementFailureCount', v_plan_reinforcement_failures
      )
    )
    on conflict (idempotency_key) do update
    set finished_at = excluded.finished_at,
        status = 'succeeded',
        result = excluded.result;
  end loop;

  return jsonb_build_object(
    'today', p_today,
    'deferredCount', v_total_deferred,
    'reinforcementCount', v_total_reinforcements,
    'reinforcementFailureCount', v_total_reinforcement_failures
  );
end;
$$;

revoke all on function public.run_jsos_daily_rollover(date) from public, anon, authenticated;
grant execute on function public.run_jsos_daily_rollover(date) to service_role;

commit;
