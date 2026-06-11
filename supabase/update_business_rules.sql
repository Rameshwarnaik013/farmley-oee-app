-- ============================================================================
-- Farmley OEE — Business-rules update (run in Supabase SQL Editor)
-- 1. plants.default_planned_hours (9 std, Kundli 12)
-- 2. machines.target_output + machines.units  (from "Target Output Pieces")
-- 3. oee_records.number_of_cycles + oee_records.units
-- 4. Re-seed machines EXACTLY from the Excel; obsolete machines -> is_active=false
-- Safe to re-run.
-- ============================================================================

-- 1. Per-plant default planned time -----------------------------------------
alter table public.plants add column if not exists default_planned_hours numeric not null default 9;
update public.plants set default_planned_hours = 9  where name in ('Indore','Purnia','UD','Rebela');
update public.plants set default_planned_hours = 12 where name = 'Kundli';

-- 2. Machine target output + units ------------------------------------------
alter table public.machines add column if not exists target_output numeric;
alter table public.machines add column if not exists units text;

-- 3. New OEE record fields ---------------------------------------------------
alter table public.oee_records add column if not exists number_of_cycles numeric;
alter table public.oee_records add column if not exists units text;

-- 4. Re-seed machines from the Excel ----------------------------------------
-- Deactivate everything first; valid machines get re-activated by the upsert.
update public.machines set is_active = false;

with p as (select id, name from public.plants),
     l as (select id, name from public.lines),
     data(plant_name, line_name, machine_name, target, units) as (
       values
         -- Indore · Packing Line
         ('Indore','Packing Line','Conti Mix',                  6500,  'Pcs'),
         ('Indore','Packing Line','FlowWrap',                   75600, 'Pcs'),
         ('Indore','Packing Line','Jar Sealing',                2500,  'Pcs'),
         ('Indore','Packing Line','Jar Sealing - WAD Machine',  2500,  'Pcs'),
         ('Indore','Packing Line','LD Pack of 2',               2500,  'Pcs'),
         ('Indore','Packing Line','LD Pack of 4',               1560,  'Pcs'),
         ('Indore','Packing Line','Pace - FFS',                 43200, 'Pcs'),
         ('Indore','Packing Line','Perfect - FFS',              32400, 'Pcs'),
         ('Indore','Packing Line','Table',                      2500,  'Pcs'),
         ('Indore','Packing Line','Table - Airlines',           18000, 'Pcs'),
         ('Indore','Packing Line','PFS1',                       12000, 'Pcs'),
         ('Indore','Packing Line','PFS2',                       12000, 'Pcs'),
         ('Indore','Packing Line','Contimix PFS',               15660, 'Pcs'),
         ('Indore','Packing Line','Contimix FFS',               6480,  'Pcs'),
         ('Indore','Packing Line','Roboarm Airlines',           27000, 'Pcs'),
         -- Indore · Roasting Line
         ('Indore','Roasting Line','Oven1',                     1500,  'Kgs'),
         ('Indore','Roasting Line','Oven2',                     1500,  'Kgs'),
         -- Indore · Mixing Line
         ('Indore','Mixing Line','Mixing Line 1',               2400,  'Kgs'),

         -- Kundli · Packing Line
         ('Kundli','Packing Line','FlowWrap Machine 1',         108000,'Pcs'),
         ('Kundli','Packing Line','FlowWrap Machine 2',         108000,'Pcs'),
         ('Kundli','Packing Line','FlowWrap Machine 3',         108000,'Pcs'),
         ('Kundli','Packing Line','FlowWrap Machine 4',         108000,'Pcs'),
         ('Kundli','Packing Line','Tin Seaming',                18000, 'Pcs'),
         ('Kundli','Packing Line','Srp Machine',                18000, 'Pcs'),
         -- Kundli · Roasting Line
         ('Kundli','Roasting Line','Roasting',                  3000,  'Kgs'),
         -- Kundli · Mixing Line
         ('Kundli','Mixing Line','kadhai 1',                    12000, 'Kgs'),
         ('Kundli','Mixing Line','kadhai 2',                    12000, 'Kgs'),
         ('Kundli','Mixing Line','kadhai 3',                    12000, 'Kgs'),
         ('Kundli','Mixing Line','kadhai 4',                    12000, 'Kgs'),
         ('Kundli','Mixing Line','kadhai 5',                    12000, 'Kgs'),

         -- Purnia (Purnea) · Packing Line
         ('Purnia','Packing Line','Can Seaming 1 (Ashoka 1)',   19200, 'Pcs'),
         ('Purnia','Packing Line','Can Seaming 2 (Ashoka 2)',   19200, 'Pcs'),
         ('Purnia','Packing Line','Can Seaming 3 (Bubber 1)',   6720,  'Pcs'),
         ('Purnia','Packing Line','Can Seaming 4 (Bubber 2)',   6720,  'Pcs'),
         ('Purnia','Packing Line','Can Seaming 5 (Bubber 3)',   3840,  'Pcs'),
         ('Purnia','Packing Line','FFS 1 (RnF FFS)',            21600, 'Pcs'),
         ('Purnia','Packing Line','FFS 2 (Prasadam FFS)',       12480, 'Pcs'),
         -- Purnia (Purnea) · Roasting Line
         ('Purnia','Roasting Line','Roasting and Flavouring Machine (Old)',          810,  'Kgs'),
         ('Purnia','Roasting Line','Roasting and Flavouring Machine-Fabcon (New)',   2250, 'Kgs')
     )
insert into public.machines (plant_id, line_id, name, target_output, units, is_active)
select p.id, l.id, d.machine_name, d.target, d.units, true
from data d
join p on p.name = d.plant_name
join l on l.name = d.line_name
on conflict (plant_id, line_id, name)
  do update set target_output = excluded.target_output,
                units         = excluded.units,
                is_active     = true;
