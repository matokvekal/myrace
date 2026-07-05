-- Commissaire cloud schema (Part 2)
-- Run this in the Supabase SQL editor (or `supabase db push`).

-- ============================================================================
-- Tables
-- ============================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz default now()
);

create table if not exists public.races (
  id uuid primary key default gen_random_uuid(),
  local_id text,                      -- RaceProps.uuid on the device that uploaded
  name text not null,
  race_date date,
  status text default 'draft',
  payload jsonb,                      -- full RaceProps snapshot (map, categories meta, etc.)
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.race_users (
  id uuid primary key default gen_random_uuid(),
  race_id uuid references public.races(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  email text not null,
  role text not null check (role in
    ('CREATOR','ADMIN','MANAGER','RIDER_MANAGER','CHECKIN','FINISH_JUDGE','VIEWER')),
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  unique (race_id, email)
);

create table if not exists public.riders (
  id uuid primary key default gen_random_uuid(),
  race_id uuid references public.races(id) on delete cascade,
  local_id text,                      -- RiderProps.id on the uploading device
  bib text not null,
  first_name text,
  last_name text,
  category text,
  team text,
  status text default 'racing',
  payload jsonb,                      -- full RiderProps snapshot
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (race_id, bib)
);

create table if not exists public.race_events (
  id uuid primary key,                -- client-generated (crypto.randomUUID)
  race_id uuid references public.races(id) on delete cascade,
  rider_id uuid references public.riders(id) on delete cascade,
  bib text,
  event_type text not null check (event_type in
    ('LAP_MARKED','RIDER_CHECKIN','DNF','DNS','UNDO','RIDER_EDITED')),
  lap_number int,
  event_time timestamptz not null,
  payload jsonb,
  created_by uuid references auth.users(id),
  device_id text,
  status text default 'accepted' check (status in ('accepted','rejected')),
  created_at timestamptz default now()
);

-- Conflict rule V1: for the same race + rider + lap, first accepted LAP wins.
create unique index if not exists unique_lap_event
  on public.race_events (race_id, rider_id, lap_number)
  where event_type = 'LAP_MARKED' and status = 'accepted';

create index if not exists race_events_race_idx on public.race_events (race_id, created_at);
create index if not exists race_users_user_idx on public.race_users (user_id);
create index if not exists race_users_email_idx on public.race_users (lower(email));

-- ============================================================================
-- Auto profile on signup
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- updated_at maintenance
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists races_set_updated_at on public.races;
create trigger races_set_updated_at
  before update on public.races
  for each row execute function public.set_updated_at();

drop trigger if exists riders_set_updated_at on public.riders;
create trigger riders_set_updated_at
  before update on public.riders
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Helpers (security definer avoids RLS recursion on race_users)
-- ============================================================================

-- My role in a race: matched by user_id, or by invited email before first claim.
create or replace function public.my_race_role(p_race_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from public.race_users
  where race_id = p_race_id
    and (user_id = auth.uid() or lower(email) = lower(auth.jwt() ->> 'email'))
  limit 1;
$$;

-- Attach my user_id to invites that were created for my email before I signed up.
create or replace function public.claim_race_invites()
returns int language plpgsql security definer set search_path = public as $$
declare claimed int;
begin
  update public.race_users
     set user_id = auth.uid()
   where user_id is null
     and lower(email) = lower(auth.jwt() ->> 'email');
  get diagnostics claimed = row_count;
  return claimed;
end;
$$;

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.profiles    enable row level security;
alter table public.races       enable row level security;
alter table public.race_users  enable row level security;
alter table public.riders      enable row level security;
alter table public.race_events enable row level security;

-- profiles: each user manages their own row
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_upsert on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_select on public.profiles for select
  using (auth.uid() = id);
create policy profiles_upsert on public.profiles for insert
  with check (auth.uid() = id);
create policy profiles_update on public.profiles for update
  using (auth.uid() = id);

-- races
drop policy if exists races_select on public.races;
drop policy if exists races_insert on public.races;
drop policy if exists races_update on public.races;
drop policy if exists races_delete on public.races;
create policy races_select on public.races for select
  using (created_by = auth.uid() or public.my_race_role(id) is not null);
create policy races_insert on public.races for insert
  with check (created_by = auth.uid());
create policy races_update on public.races for update
  using (public.my_race_role(id) in ('CREATOR','ADMIN','MANAGER') or created_by = auth.uid());
create policy races_delete on public.races for delete
  using (public.my_race_role(id) in ('CREATOR','ADMIN') or created_by = auth.uid());

-- race_users: members can read; only CREATOR/ADMIN manage
drop policy if exists race_users_select on public.race_users;
drop policy if exists race_users_insert on public.race_users;
drop policy if exists race_users_update on public.race_users;
drop policy if exists race_users_delete on public.race_users;
create policy race_users_select on public.race_users for select
  using (public.my_race_role(race_id) is not null);
create policy race_users_insert on public.race_users for insert
  with check (public.my_race_role(race_id) in ('CREATOR','ADMIN'));
create policy race_users_update on public.race_users for update
  using (public.my_race_role(race_id) in ('CREATOR','ADMIN'));
create policy race_users_delete on public.race_users for delete
  using (public.my_race_role(race_id) in ('CREATOR','ADMIN'));

-- riders
drop policy if exists riders_select on public.riders;
drop policy if exists riders_insert on public.riders;
drop policy if exists riders_update on public.riders;
drop policy if exists riders_delete on public.riders;
create policy riders_select on public.riders for select
  using (public.my_race_role(race_id) is not null);
create policy riders_insert on public.riders for insert
  with check (public.my_race_role(race_id) in ('CREATOR','ADMIN','MANAGER','RIDER_MANAGER'));
create policy riders_update on public.riders for update
  using (public.my_race_role(race_id) in ('CREATOR','ADMIN','MANAGER','RIDER_MANAGER'));
create policy riders_delete on public.riders for delete
  using (public.my_race_role(race_id) in ('CREATOR','ADMIN','MANAGER','RIDER_MANAGER'));

-- race_events: members read; writes gated per event type by role
drop policy if exists race_events_select on public.race_events;
drop policy if exists race_events_insert on public.race_events;
create policy race_events_select on public.race_events for select
  using (public.my_race_role(race_id) is not null);
create policy race_events_insert on public.race_events for insert
  with check (
    created_by = auth.uid()
    and (
      (event_type in ('LAP_MARKED','DNF','DNS','UNDO')
        and public.my_race_role(race_id) in ('CREATOR','ADMIN','MANAGER','FINISH_JUDGE'))
      or (event_type = 'RIDER_CHECKIN'
        and public.my_race_role(race_id) in ('CREATOR','ADMIN','MANAGER','CHECKIN'))
      or (event_type = 'RIDER_EDITED'
        and public.my_race_role(race_id) in ('CREATOR','ADMIN','MANAGER','RIDER_MANAGER'))
    )
  );

-- ============================================================================
-- Realtime
-- ============================================================================

do $$
begin
  alter publication supabase_realtime add table public.race_events;
exception
  when duplicate_object then null; -- already added on a previous run
end $$;
