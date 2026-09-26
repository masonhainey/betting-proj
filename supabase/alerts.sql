-- hedgehog: push alerts (devices that want notifications, and what's already been sent).
-- Run AFTER schema.sql: Supabase → SQL Editor → New query → paste this file → Run.
-- Safe to re-run.

-- One row per device that turned alerts on.
create table if not exists public.push_subscriptions (
  endpoint   text        primary key,
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  p256dh     text        not null,
  auth       text        not null,
  prefs      jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
drop policy if exists "push: read own"   on public.push_subscriptions;
drop policy if exists "push: insert own" on public.push_subscriptions;
drop policy if exists "push: update own" on public.push_subscriptions;
drop policy if exists "push: delete own" on public.push_subscriptions;
create policy "push: read own"   on public.push_subscriptions for select using (user_id = auth.uid());
create policy "push: insert own" on public.push_subscriptions for insert with check (user_id = auth.uid());
create policy "push: update own" on public.push_subscriptions for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "push: delete own" on public.push_subscriptions for delete using (user_id = auth.uid());

-- Alerts the server already sent, so nobody gets the same one twice.
-- Only the alerts worker (secret key) touches this table.
create table if not exists public.push_log (
  user_id uuid        not null references auth.users on delete cascade,
  key     text        not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.push_log enable row level security;

-- Server-only settings (the push signing keys). No policies = only the secret key can read.
create table if not exists public.app_secrets (
  name  text  primary key,
  value jsonb not null
);
alter table public.app_secrets enable row level security;

-- Devices need the PUBLIC half of the push signing key to subscribe.
create or replace function public.vapid_public_key() returns text
language sql security definer stable set search_path = public as $$
  select value->>'publicKey' from public.app_secrets where name = 'vapid'
$$;
grant execute on function public.vapid_public_key() to anon, authenticated;
