-- =============================================================================
-- Farmley OEE - full schema, dumped from project qvyoiovlblorahqkatlj
-- (the project Supabase restricted with exceed_egress_quota on the free tier).
-- Run this FIRST on the replacement project, then 02_auth_users.sql,
-- then 03_data.sql.
-- =============================================================================

-- ----------------------------------------------------------------- tables ---
create table if not exists public.plants (
  id uuid default gen_random_uuid() not null,
  name text not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  default_planned_hours numeric default 9 not null
);

create table if not exists public.lines (
  id uuid default gen_random_uuid() not null,
  name text not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.machines (
  id uuid default gen_random_uuid() not null,
  plant_id uuid not null,
  line_id uuid not null,
  name text not null,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  target_output numeric,
  units text,
  pieces_per_minute numeric
);

create table if not exists public.profiles (
  id uuid not null,
  email text,
  full_name text,
  role text default 'user'::text not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.user_plants (
  user_id uuid not null,
  plant_id uuid not null
);

create table if not exists public.machine_status_defaults (
  plant_name text not null,
  line_name text not null,
  machine_name text not null,
  shift text not null,
  status text default 'Not Planned for Production'::text not null
);

create table if not exists public.oee_records (
  id uuid default gen_random_uuid() not null,
  created_by uuid,
  plant_id uuid not null,
  line_id uuid not null,
  machine_id uuid,
  record_date date default CURRENT_DATE not null,
  shift text,
  planned_time_hours numeric not null,
  planned_time_minutes numeric,
  downtime_minutes numeric default 0 not null,
  actual_output numeric default 0 not null,
  target_output numeric default 0 not null,
  good_qty numeric default 0 not null,
  availability_pct numeric,
  performance_pct numeric,
  quality_pct numeric,
  oee_pct numeric,
  synced_to_sheet boolean default false not null,
  created_at timestamp with time zone default now() not null,
  number_of_cycles numeric,
  units text,
  operational_hours numeric,
  pieces_per_minute numeric,
  machine_status text default 'Running / Planned for Production'::text not null,
  row_code text
);

-- ------------------------------------------------------------ constraints ---
alter table public.plants add constraint plants_pkey primary key (id);
alter table public.plants add constraint plants_name_key unique (name);

alter table public.lines add constraint lines_pkey primary key (id);
alter table public.lines add constraint lines_name_key unique (name);

alter table public.machines add constraint machines_pkey primary key (id);
alter table public.machines add constraint machines_plant_id_fkey foreign key (plant_id) references plants(id) on delete cascade;
alter table public.machines add constraint machines_line_id_fkey foreign key (line_id) references lines(id) on delete cascade;
alter table public.machines add constraint machines_plant_id_line_id_name_key unique (plant_id, line_id, name);

alter table public.profiles add constraint profiles_pkey primary key (id);
alter table public.profiles add constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade;
alter table public.profiles add constraint profiles_role_check check ((role = any (array['admin'::text, 'user'::text])));

alter table public.user_plants add constraint user_plants_pkey primary key (user_id, plant_id);
alter table public.user_plants add constraint user_plants_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.user_plants add constraint user_plants_plant_id_fkey foreign key (plant_id) references plants(id) on delete cascade;

alter table public.machine_status_defaults add constraint machine_status_defaults_pkey primary key (plant_name, line_name, machine_name, shift);
alter table public.machine_status_defaults add constraint machine_status_defaults_shift_check check ((shift = any (array['Day'::text, 'Night'::text])));

alter table public.oee_records add constraint oee_records_pkey primary key (id);
alter table public.oee_records add constraint oee_records_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
alter table public.oee_records add constraint oee_records_plant_id_fkey foreign key (plant_id) references plants(id);
alter table public.oee_records add constraint oee_records_line_id_fkey foreign key (line_id) references lines(id);
alter table public.oee_records add constraint oee_records_machine_id_fkey foreign key (machine_id) references machines(id);
alter table public.oee_records add constraint oee_records_machine_status_chk check ((machine_status = any (array['Running / Planned for Production'::text, 'Not Planned for Production'::text])));

-- ---------------------------------------------------------------- indexes ---
create index if not exists oee_records_plant_idx on public.oee_records using btree (plant_id);
create index if not exists oee_records_date_idx  on public.oee_records using btree (record_date);
create unique index if not exists oee_records_row_code_uidx on public.oee_records using btree (row_code);

-- -------------------------------------------------------------- functions ---
create or replace function public.is_admin()
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$function$;

create or replace function public.can_access_plant(p_plant_id uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select public.is_admin()
      or exists (
           select 1 from public.user_plants up
           where up.user_id = auth.uid() and up.plant_id = p_plant_id
         );
$function$;

create or replace function public.handle_new_user()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$function$;

create or replace function public.oee_row_code()
 returns trigger language plpgsql
as $function$
begin
  new.row_code := md5(
    coalesce(new.plant_id::text,'')        || '|' ||
    coalesce(new.line_id::text,'')         || '|' ||
    coalesce(new.machine_id::text,'')      || '|' ||
    coalesce(new.record_date::text,'')     || '|' ||
    coalesce(new.shift,'')                 || '|' ||
    coalesce(new.machine_status,'')        || '|' ||
    coalesce(new.planned_time_hours::text,'')  || '|' ||
    coalesce(new.downtime_minutes::text,'')    || '|' ||
    coalesce(new.operational_hours::text,'')   || '|' ||
    coalesce(new.pieces_per_minute::text,'')   || '|' ||
    coalesce(new.number_of_cycles::text,'')    || '|' ||
    coalesce(new.actual_output::text,'')       || '|' ||
    coalesce(new.target_output::text,'')       || '|' ||
    coalesce(new.good_qty::text,'')
  );
  return new;
end;
$function$;

-- --------------------------------------------------------------- triggers ---
drop trigger if exists oee_row_code_trg on public.oee_records;
create trigger oee_row_code_trg
  before insert or update on public.oee_records
  for each row execute function public.oee_row_code();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------ view ----
create or replace view public.machine_shift_plan as
 select p.name as plant_name,
    l.name as line_name,
    m.name as machine_name,
    s.shift,
    coalesce(d.status, 'Running / Planned for Production'::text) as default_status
   from machines m
     join plants p on p.id = m.plant_id
     join lines l on l.id = m.line_id
     cross join ( values ('Day'::text), ('Night'::text)) s(shift)
     left join machine_status_defaults d on d.plant_name = p.name and d.line_name = l.name and d.machine_name = m.name and d.shift = s.shift
  where m.is_active;

-- ------------------------------------------------------------------- RLS ----
alter table public.plants      enable row level security;
alter table public.lines       enable row level security;
alter table public.machines    enable row level security;
alter table public.profiles    enable row level security;
alter table public.user_plants enable row level security;
alter table public.oee_records enable row level security;

create policy "plants read"  on public.plants for select to authenticated using (true);
create policy "plants admin" on public.plants for all    to authenticated using (is_admin()) with check (is_admin());

create policy "lines read"   on public.lines  for select to authenticated using (true);
create policy "lines admin"  on public.lines  for all    to authenticated using (is_admin()) with check (is_admin());

create policy "machines read"  on public.machines for select to authenticated using (true);
create policy "machines admin" on public.machines for all    to authenticated using (is_admin()) with check (is_admin());

create policy "profiles self read"   on public.profiles for select to authenticated using ((id = auth.uid()) or is_admin());
create policy "profiles self update" on public.profiles for update to authenticated using ((id = auth.uid()) or is_admin()) with check ((id = auth.uid()) or is_admin());
create policy "profiles admin all"   on public.profiles for all    to authenticated using (is_admin()) with check (is_admin());

create policy "user_plants self read" on public.user_plants for select to authenticated using ((user_id = auth.uid()) or is_admin());
create policy "user_plants admin"     on public.user_plants for all    to authenticated using (is_admin()) with check (is_admin());

create policy "oee read"   on public.oee_records for select to authenticated using (can_access_plant(plant_id));
create policy "oee insert" on public.oee_records for insert to authenticated with check ((can_access_plant(plant_id) and (created_by = auth.uid())));
create policy "oee update" on public.oee_records for update to authenticated using (can_access_plant(plant_id)) with check (can_access_plant(plant_id));
create policy "oee delete" on public.oee_records for delete to authenticated using (is_admin());
