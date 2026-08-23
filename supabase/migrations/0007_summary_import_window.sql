begin;

create or replace function public.enforce_jsos_summary_import_window()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_scheduled_for date;
  v_training_date date := (((now() at time zone 'Asia/Shanghai') - interval '1 hour')::date);
begin
  select scheduled_for
  into v_scheduled_for
  from public.tasks
  where id = new.task_id
    and user_id = new.user_id;

  if v_scheduled_for is null or v_scheduled_for <> v_training_date then
    raise exception 'summary import window closed';
  end if;

  return new;
end;
$$;

drop trigger if exists training_sessions_import_window on public.training_sessions;

create trigger training_sessions_import_window
before insert or update on public.training_sessions
for each row execute function public.enforce_jsos_summary_import_window();

revoke all on function public.enforce_jsos_summary_import_window() from public, anon, authenticated;

commit;
