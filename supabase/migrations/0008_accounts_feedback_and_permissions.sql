begin;

create type public.jsos_user_role as enum ('user', 'admin');
create type public.feedback_status as enum ('unread', 'read');

alter table public.profiles
add column role public.jsos_user_role not null default 'user',
add column password_prompt_pending boolean not null default true,
add column access_enabled boolean not null default true;

drop policy if exists "own profile" on public.profiles;
create policy "read own profile"
on public.profiles for select to authenticated
using ((select auth.uid()) = id);

create or replace function public.is_jsos_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select role = 'admin' from public.profiles where id = (select auth.uid())), false)
$$;

revoke all on function public.is_jsos_admin() from public, anon;
grant execute on function public.is_jsos_admin() to authenticated;

create or replace function public.dismiss_jsos_password_prompt()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  update public.profiles
  set password_prompt_pending = false, updated_at = now()
  where id = (select auth.uid());
end;
$$;

revoke all on function public.dismiss_jsos_password_prompt() from public, anon;
grant execute on function public.dismiss_jsos_password_prompt() to authenticated;

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  user_email text not null,
  body text not null check (char_length(btrim(body)) between 1 and 500),
  image_paths text[] not null default '{}',
  status public.feedback_status not null default 'unread',
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (cardinality(image_paths) <= 5),
  check ((status = 'unread' and read_at is null) or status = 'read')
);

create index feedback_created_idx on public.feedback(created_at desc);
create index feedback_user_date_idx on public.feedback(user_id, created_at desc);
create index feedback_unread_idx on public.feedback(status, created_at desc) where status = 'unread';

alter table public.feedback enable row level security;

create policy "submit own feedback"
on public.feedback for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "read own or admin feedback"
on public.feedback for select to authenticated
using ((select auth.uid()) = user_id or public.is_jsos_admin());

create policy "admin updates feedback"
on public.feedback for update to authenticated
using (public.is_jsos_admin())
with check (public.is_jsos_admin());

create policy "admin deletes feedback"
on public.feedback for delete to authenticated
using (public.is_jsos_admin());

grant select, insert on public.feedback to authenticated;
grant update, delete on public.feedback to authenticated;

create or replace function public.submit_jsos_feedback(
  p_body text,
  p_image_paths text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_email text;
  v_id uuid;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai';
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  select email into v_email from public.profiles where id = v_user_id and access_enabled = true;
  if v_email is null then raise exception 'account disabled'; end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 500 then raise exception 'feedback length invalid'; end if;
  if cardinality(coalesce(p_image_paths, '{}')) > 5 then raise exception 'too many images'; end if;
  if exists (select 1 from unnest(coalesce(p_image_paths, '{}')) path where path not like v_user_id::text || '/%') then
    raise exception 'invalid image path';
  end if;
  perform pg_advisory_xact_lock(hashtext('feedback:' || v_user_id::text));
  if (select count(*) from public.feedback where user_id = v_user_id and created_at >= v_day_start) >= 10 then
    raise exception 'daily feedback limit reached';
  end if;
  insert into public.feedback (user_id, user_email, body, image_paths)
  values (v_user_id, v_email, btrim(p_body), coalesce(p_image_paths, '{}'))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.submit_jsos_feedback(text, text[]) from public, anon;
grant execute on function public.submit_jsos_feedback(text, text[]) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-images', 'feedback-images', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

commit;
