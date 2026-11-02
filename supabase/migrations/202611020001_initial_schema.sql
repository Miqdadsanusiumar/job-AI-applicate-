create extension if not exists pgcrypto;

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 120),
  target_role text not null default '' check (char_length(target_role) <= 160),
  location text not null default '' check (char_length(location) <= 160),
  linkedin_url text not null default '' check (char_length(linkedin_url) <= 500),
  portfolio_url text not null default '' check (char_length(portfolio_url) <= 500),
  keywords text[] not null default '{}',
  resume_path text,
  email_notifications boolean not null default false,
  scans_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.job_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('greenhouse', 'lever')),
  board_slug text not null check (board_slug ~ '^[A-Za-z0-9_-]{1,100}$'),
  company_name text not null check (char_length(company_name) between 1 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, provider, board_slug),
  unique (id, user_id)
);

create table public.job_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_id uuid not null,
  external_id text not null,
  company_name text not null,
  title text not null,
  location text not null default '',
  employment_type text not null default '',
  job_url text not null,
  description text not null default '',
  match_score smallint not null check (match_score between 0 and 100),
  match_reason text not null,
  status text not null default 'new' check (status in ('new', 'approved', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (user_id, source_id, external_id),
  unique (id, user_id),
  foreign key (source_id, user_id)
    references public.job_sources (id, user_id) on delete cascade
);

create table public.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  match_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'cancelled')),
  attempts smallint not null default 0,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (match_id),
  foreign key (match_id, user_id)
    references public.job_matches (id, user_id) on delete cascade
);

create table public.notification_rate_limits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_test_sent_at timestamptz not null default now()
);

create table public.scan_state (
  scan_name text primary key,
  cursor_id uuid,
  updated_at timestamptz not null default now()
);

create index job_sources_active_idx on public.job_sources (active) where active;
create index job_matches_user_created_idx on public.job_matches (user_id, created_at desc);
create index email_deliveries_pending_idx on public.email_deliveries (created_at) where status = 'pending';

create or replace function public.enforce_job_source_limit()
returns trigger
language plpgsql
as $$
declare
  active_source_count integer;
begin
  if new.active and tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
    select count(*) into active_source_count
      from public.job_sources
      where user_id = new.user_id and active;
    if active_source_count >= 10 then
      raise exception 'A user can have at most 10 active job sources'
        using errcode = '23514';
    end if;
  elsif new.active and tg_op = 'UPDATE' and not old.active then
    perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
    select count(*) into active_source_count
      from public.job_sources
      where user_id = new.user_id and active;
    if active_source_count >= 10 then
      raise exception 'A user can have at most 10 active job sources'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

alter table public.profiles enable row level security;
alter table public.job_sources enable row level security;
alter table public.job_matches enable row level security;
alter table public.email_deliveries enable row level security;
alter table public.notification_rate_limits enable row level security;
alter table public.scan_state enable row level security;

create policy "Users manage their own profile"
  on public.profiles for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users manage their own job sources"
  on public.job_sources for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users read their own matches"
  on public.job_matches for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users update their own matches"
  on public.job_matches for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.job_sources to authenticated;
grant select on public.job_matches to authenticated;
revoke update on public.job_matches from anon, authenticated;
grant update (status) on public.job_matches to authenticated;

create or replace function public.claim_email_test_window()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_user uuid;
begin
  if auth.uid() is null then
    return false;
  end if;

  insert into public.notification_rate_limits (user_id)
  values (auth.uid())
  on conflict (user_id) do update
    set last_test_sent_at = now()
    where public.notification_rate_limits.last_test_sent_at < now() - interval '10 minutes'
  returning user_id into claimed_user;

  return claimed_user is not null;
end;
$$;

revoke all on function public.claim_email_test_window() from public;
grant execute on function public.claim_email_test_window() to authenticated;

create or replace function public.insert_job_matches_and_queue_notifications(
  p_matches jsonb,
  p_queue_notifications boolean
)
returns table (id uuid, user_id uuid)
language sql
security definer
set search_path = ''
as $$
  with created as (
    insert into public.job_matches (
      user_id, source_id, external_id, company_name, title, location,
      employment_type, job_url, description, match_score, match_reason
    )
    select
      candidate.user_id, candidate.source_id, candidate.external_id,
      candidate.company_name, candidate.title, candidate.location,
      candidate.employment_type, candidate.job_url, candidate.description,
      candidate.match_score, candidate.match_reason
    from jsonb_to_recordset(p_matches) as candidate(
      user_id uuid,
      source_id uuid,
      external_id text,
      company_name text,
      title text,
      location text,
      employment_type text,
      job_url text,
      description text,
      match_score smallint,
      match_reason text
    )
    on conflict (user_id, source_id, external_id) do nothing
    returning public.job_matches.id, public.job_matches.user_id
  ),
  queued as (
    insert into public.email_deliveries (user_id, match_id)
    select created.user_id, created.id
    from created
    where p_queue_notifications
    on conflict (match_id) do nothing
    returning public.email_deliveries.match_id
  )
  select created.id, created.user_id from created;
$$;

revoke all on function public.insert_job_matches_and_queue_notifications(jsonb, boolean) from public;
revoke all on function public.insert_job_matches_and_queue_notifications(jsonb, boolean) from anon, authenticated;
grant execute on function public.insert_job_matches_and_queue_notifications(jsonb, boolean) to service_role;

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger enforce_job_source_limit
  before insert or update on public.job_sources
  for each row execute function public.enforce_job_source_limit();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'resumes',
  'resumes',
  false,
  5242880,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do nothing;

create policy "Users upload their own resumes"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users read their own resumes"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users replace their own resumes"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users delete their own resumes"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
