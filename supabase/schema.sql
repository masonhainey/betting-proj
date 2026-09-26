-- hedgehog: accounts + sync.
-- Paste this whole file into Supabase → SQL Editor → New query → Run. Safe to re-run.

create table if not exists public.records (
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  id         text        not null,
  kind       text        not null default 'bet' check (kind in ('bet', 'settings')),
  data       jsonb,
  deleted    boolean     not null default false,
  updated_at timestamptz not null,               -- when the device made the change
  synced_at  timestamptz not null default clock_timestamp(), -- when the server stored it
  primary key (user_id, id)
);

create index if not exists records_user_synced on public.records (user_id, synced_at);

-- Every account can only see and change its own rows.
alter table public.records enable row level security;

drop policy if exists "records: read own"   on public.records;
drop policy if exists "records: insert own" on public.records;
drop policy if exists "records: update own" on public.records;
drop policy if exists "records: delete own" on public.records;
create policy "records: read own"   on public.records for select using (auth.uid() = user_id);
create policy "records: insert own" on public.records for insert with check (auth.uid() = user_id);
create policy "records: update own" on public.records for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "records: delete own" on public.records for delete using (auth.uid() = user_id);

-- Last write wins: an older edit arriving late (a phone that was offline) can't overwrite
-- a newer one. Also stamps synced_at with the server clock so devices can ask for
-- "everything since X" without trusting each other's clocks.
create or replace function public.records_lww() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null; -- keep the newer row
  end if;
  new.synced_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists records_lww on public.records;
create trigger records_lww before insert or update on public.records
  for each row execute function public.records_lww();
