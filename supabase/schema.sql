-- ============================================================================
-- Farmley OEE Monitoring — Supabase schema
-- Run this in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. MASTER DATA (editable later without redeploying the app)
-- ----------------------------------------------------------------------------

-- Plants: Indore, Purnia, Kundli, UD, Rebela
create table if not exists public.plants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  sort_order  int  not null default 0,
  default_planned_hours numeric not null default 9,  -- 9 std, Kundli 12
  created_at  timestamptz not null default now()
);

-- Line types: ONLY Roasting Line, Packing Line, Mixing Line
create table if not exists public.lines (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- Machines / sub-lines, each belonging to a plant + a line type
create table if not exists public.machines (
  id          uuid primary key default gen_random_uuid(),
  plant_id    uuid not null references public.plants(id) on delete cascade,
  line_id     uuid not null references public.lines(id) on delete cascade,
  name        text not null,
  target_output numeric,                 -- Per Shift Production (auto-fills form)
  units       text,                       -- 'Pcs' or 'Kgs'
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (plant_id, line_id, name)
);

-- ----------------------------------------------------------------------------
-- 2. USER PROFILES + ROLE + PLANT ACCESS
-- ----------------------------------------------------------------------------

-- One profile per auth user. role = 'admin' or 'user'.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  role        text not null default 'user' check (role in ('admin','user')),
  created_at  timestamptz not null default now()
);

-- Which plants a user is allowed to access (admins see all regardless).
create table if not exists public.user_plants (
  user_id     uuid not null references auth.users(id) on delete cascade,
  plant_id    uuid not null references public.plants(id) on delete cascade,
  primary key (user_id, plant_id)
);

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper: is the current user an admin?
create or replace function public.is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- Helper: may the current user access this plant?
create or replace function public.can_access_plant(p_plant_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select public.is_admin()
      or exists (
           select 1 from public.user_plants up
           where up.user_id = auth.uid() and up.plant_id = p_plant_id
         );
$$;

-- ----------------------------------------------------------------------------
-- 3. OEE RECORDS  (the OEE Monitoring Sheet rows)
-- ----------------------------------------------------------------------------

create table if not exists public.oee_records (
  id                uuid primary key default gen_random_uuid(),
  created_by        uuid references auth.users(id) on delete set null,
  plant_id          uuid not null references public.plants(id),
  line_id           uuid not null references public.lines(id),
  machine_id        uuid references public.machines(id),

  record_date       date not null default current_date,
  shift             text,
  number_of_cycles  numeric,                          -- Roasting Line only
  units             text,                             -- 'Pcs' or 'Kgs'

  -- Inputs
  planned_time_hours    numeric not null,                 -- entered in HOURS
  planned_time_minutes  numeric generated always as (planned_time_hours * 60) stored,
  downtime_minutes      numeric not null default 0,       -- entered in minutes
  actual_output         numeric not null default 0,       -- pieces
  target_output         numeric not null default 0,       -- pieces
  good_qty              numeric not null default 0,       -- pieces

  -- Calculated % (0..100). Stored so they sync cleanly to Google Sheets.
  availability_pct  numeric,
  performance_pct   numeric,
  quality_pct       numeric,
  oee_pct           numeric,

  synced_to_sheet   boolean not null default false,
  created_at        timestamptz not null default now()
);

create index if not exists oee_records_plant_idx on public.oee_records (plant_id);
create index if not exists oee_records_date_idx  on public.oee_records (record_date);

-- ----------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------

alter table public.plants       enable row level security;
alter table public.lines        enable row level security;
alter table public.machines     enable row level security;
alter table public.profiles     enable row level security;
alter table public.user_plants  enable row level security;
alter table public.oee_records  enable row level security;

-- Master data: any logged-in user can read; only admins can modify.
create policy "plants read"   on public.plants   for select to authenticated using (true);
create policy "plants admin"  on public.plants   for all    to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "lines read"    on public.lines    for select to authenticated using (true);
create policy "lines admin"   on public.lines    for all    to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "machines read"  on public.machines for select to authenticated using (true);
create policy "machines admin" on public.machines for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- Profiles: a user can read/update their own; admins can read/manage all.
create policy "profiles self read"   on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "profiles self update" on public.profiles for update to authenticated using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy "profiles admin all"   on public.profiles for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- User-plant mapping: user can read their own; admins manage all.
create policy "user_plants self read" on public.user_plants for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "user_plants admin"     on public.user_plants for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- OEE records: a user can read/insert for plants they may access; admins all.
create policy "oee read"   on public.oee_records for select to authenticated using (public.can_access_plant(plant_id));
create policy "oee insert" on public.oee_records for insert to authenticated with check (public.can_access_plant(plant_id) and created_by = auth.uid());
create policy "oee update" on public.oee_records for update to authenticated using (public.can_access_plant(plant_id)) with check (public.can_access_plant(plant_id));
create policy "oee delete" on public.oee_records for delete to authenticated using (public.is_admin());
