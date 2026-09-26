-- hedgehog: friends leaderboard (groups + shared stats).
-- Run AFTER schema.sql: Supabase → SQL Editor → New query → paste this file → Run.
-- Safe to re-run.

-- A private group, joined with an invite code.
create table if not exists public.groups (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null check (char_length(name) between 1 and 40),
  invite_code text        not null unique,
  created_by  uuid        not null default auth.uid() references auth.users on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id     uuid        not null references public.groups on delete cascade,
  user_id      uuid        not null default auth.uid() references auth.users on delete cascade,
  display_name text        not null check (char_length(display_name) between 1 and 30),
  joined_at    timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- One row per person: the summary their app publishes (records W-L, profit in units,
-- ROI, streak per period) and, if they allow it, their open picks. Never stakes.
create table if not exists public.member_stats (
  user_id    uuid        primary key default auth.uid() references auth.users on delete cascade,
  stats      jsonb       not null default '{}'::jsonb,
  picks      jsonb       not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- Helpers run with elevated rights so the policies below don't recurse into themselves.
create or replace function public.my_group_ids() returns setof uuid
language sql security definer stable set search_path = public as $$
  select group_id from public.group_members where user_id = auth.uid()
$$;

create or replace function public.shares_group_with(other uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.group_members a
    join public.group_members b on a.group_id = b.group_id
    where a.user_id = auth.uid() and b.user_id = other
  )
$$;

alter table public.groups        enable row level security;
alter table public.group_members enable row level security;
alter table public.member_stats  enable row level security;

-- Groups: visible only to members. Created/joined only through the functions below.
drop policy if exists "groups: members read" on public.groups;
create policy "groups: members read" on public.groups for select using (id in (select public.my_group_ids()));

-- Membership: members see each other; you can rename yourself or leave.
drop policy if exists "members: read my groups" on public.group_members;
drop policy if exists "members: update self"    on public.group_members;
drop policy if exists "members: leave"          on public.group_members;
create policy "members: read my groups" on public.group_members for select using (group_id in (select public.my_group_ids()));
create policy "members: update self"    on public.group_members for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "members: leave"          on public.group_members for delete using (user_id = auth.uid());

-- Stats: you write your own; you can read anyone you share a group with.
drop policy if exists "stats: read groupmates" on public.member_stats;
drop policy if exists "stats: insert own"      on public.member_stats;
drop policy if exists "stats: update own"      on public.member_stats;
create policy "stats: read groupmates" on public.member_stats for select using (user_id = auth.uid() or public.shares_group_with(user_id));
create policy "stats: insert own"      on public.member_stats for insert with check (user_id = auth.uid());
create policy "stats: update own"      on public.member_stats for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Create a group (you're its first member). Returns the group, including its invite code.
create or replace function public.create_group(p_name text, p_display text) returns public.groups
language plpgsql security definer set search_path = public as $$
declare
  g public.groups;
  code text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if (select count(*) from public.groups where created_by = auth.uid()) >= 20 then
    raise exception 'You''ve created the maximum number of groups';
  end if;
  loop
    -- 6 characters, no look-alikes (0/O, 1/I/L)
    select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
      into code from generate_series(1, 6);
    exit when not exists (select 1 from public.groups where invite_code = code);
  end loop;
  insert into public.groups (name, invite_code, created_by) values (trim(p_name), code, auth.uid()) returning * into g;
  insert into public.group_members (group_id, user_id, display_name) values (g.id, auth.uid(), trim(p_display));
  return g;
end $$;

-- Join with an invite code (or update your display name if you're already in).
create or replace function public.join_group(p_code text, p_display text) returns public.groups
language plpgsql security definer set search_path = public as $$
declare
  g public.groups;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into g from public.groups where invite_code = upper(trim(p_code));
  if not found then raise exception 'No group with that code'; end if;
  if (select count(*) from public.group_members where group_id = g.id) >= 50
     and not exists (select 1 from public.group_members where group_id = g.id and user_id = auth.uid()) then
    raise exception 'That group is full';
  end if;
  insert into public.group_members (group_id, user_id, display_name) values (g.id, auth.uid(), trim(p_display))
    on conflict (group_id, user_id) do update set display_name = excluded.display_name;
  return g;
end $$;

revoke execute on function public.create_group(text, text) from anon;
revoke execute on function public.join_group(text, text) from anon;
grant execute on function public.create_group(text, text) to authenticated;
grant execute on function public.join_group(text, text) to authenticated;
