-- ============================================================================
-- Farmley OEE — Business-rules update (run in Supabase SQL Editor)
-- 1. plants.default_planned_hours (9 std, Kundli 12)
-- 2. machines.target_output + machines.units + machines.pieces_per_minute
-- 3. oee_records.number_of_cycles + oee_records.units + operational hours fields
-- 4. Re-seed machines EXACTLY from the Excel; obsolete machines -> is_active=false
-- Safe to re-run.
-- ============================================================================

-- 1. Per-plant default planned time -----------------------------------------
alter table public.plants add column if not exists default_planned_hours numeric not null default 9;
update public.plants set default_planned_hours = 9  where name in ('Indore','Purnia','UD','Rebela');
update public.plants set default_planned_hours = 12 where name = 'Kundli';

-- 2. Machine target output + units ------------------------------------------
alter table public.machines add column if not exists target_output numeric;
alter table public.machines add column if not exists pieces_per_minute numeric;
alter table public.machines add column if not exists units text;

-- 3. New OEE record fields ---------------------------------------------------
alter table public.oee_records add column if not exists number_of_cycles numeric;
alter table public.oee_records add column if not exists units text;
alter table public.oee_records add column if not exists operational_hours numeric;
alter table public.oee_records add column if not exists pieces_per_minute numeric;

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
         ('Indore','Packing Line','Jar Sealing - WAD Machine',  3000,  'Pcs'),
         ('Indore','Packing Line','LD Pack of 2',               2500,  'Pcs'),
         ('Indore','Packing Line','LD Pack of 4',               1560,  'Pcs'),
         ('Indore','Packing Line','Pace - FFS',                 33600, 'Pcs'),
         ('Indore','Packing Line','Perfect - FFS',              18900, 'Pcs'),
         ('Indore','Packing Line','Table',                      3000,  'Pcs'),
         ('Indore','Packing Line','Table - Airlines',           18000, 'Pcs'),
         ('Indore','Packing Line','PFS1',                       12000, 'Pcs'),
         ('Indore','Packing Line','PFS2',                       12000, 'Pcs'),
         ('Indore','Packing Line','PFS3',                       10500, 'Pcs'),
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

-- 5. Populate Pieces Per Minute (PPM) from Conditions (1).xlsx --------------
update public.machines m
set pieces_per_minute = v.ppm
from (values
  ('Indore', 'Packing Line',  'Conti Mix',                                    12.037037037037036),
  ('Indore', 'Packing Line',  'FlowWrap',                                     210.18333333333334),
  ('Indore', 'Packing Line',  'Jar Sealing',                                  4.62962962962963),
  ('Indore', 'Packing Line',  'Jar Sealing - WAD Machine',                    4.62962962962963),
  ('Indore', 'Packing Line',  'LD Pack of 2',                                 4.62962962962963),
  ('Indore', 'Packing Line',  'LD Pack of 4',                                 2.888888888888889),
  ('Indore', 'Packing Line',  'Pace - FFS',                                   62.22222222222222),
  ('Indore', 'Packing Line',  'Perfect - FFS',                                35),
  ('Indore', 'Packing Line',  'Table',                                        4.62962962962963),
  ('Indore', 'Packing Line',  'Table - Airlines',                             33.333333333333336),
  ('Indore', 'Packing Line',  'PFS1',                                         22.22222222222222),
  ('Indore', 'Packing Line',  'PFS2',                                         22.22222222222222),
  ('Indore', 'Packing Line',  'PFS3',                                         19.444444444444446),
  ('Indore', 'Packing Line',  'Contimix PFS',                                 29),
  ('Indore', 'Packing Line',  'Contimix FFS',                                 12),
  ('Indore', 'Packing Line',  'Roboarm Airlines',                             50),
  ('Indore', 'Roasting Line', 'Oven1',                                        2.7777777777777777),
  ('Indore', 'Roasting Line', 'Oven2',                                        2.7777777777777777),
  ('Indore', 'Mixing Line',   'Mixing Line 1',                                4.444444444444445),
  ('Kundli', 'Packing Line',  'FlowWrap Machine 1',                           150),
  ('Kundli', 'Packing Line',  'FlowWrap Machine 2',                           150),
  ('Kundli', 'Packing Line',  'FlowWrap Machine 3',                           150),
  ('Kundli', 'Packing Line',  'FlowWrap Machine 4',                           150),
  ('Kundli', 'Packing Line',  'Tin Seaming',                                  25),
  ('Kundli', 'Packing Line',  'Srp Machine',                                  25),
  ('Kundli', 'Roasting Line', 'Roasting',                                     4.166666666666667),
  ('Kundli', 'Mixing Line',   'kadhai 1',                                     16.666666666666668),
  ('Kundli', 'Mixing Line',   'kadhai 2',                                     16.666666666666668),
  ('Kundli', 'Mixing Line',   'kadhai 3',                                     16.666666666666668),
  ('Kundli', 'Mixing Line',   'kadhai 4',                                     16.666666666666668),
  ('Kundli', 'Mixing Line',   'kadhai 5',                                     16.666666666666668),
  ('Purnia', 'Packing Line',  'Can Seaming 1 (Ashoka 1)',                     35.55555555555556),
  ('Purnia', 'Packing Line',  'Can Seaming 2 (Ashoka 2)',                     35.55555555555556),
  ('Purnia', 'Packing Line',  'Can Seaming 3 (Bubber 1)',                     12.444444444444445),
  ('Purnia', 'Packing Line',  'Can Seaming 4 (Bubber 2)',                     12.444444444444445),
  ('Purnia', 'Packing Line',  'Can Seaming 5 (Bubber 3)',                     7.111111111111112),
  ('Purnia', 'Packing Line',  'FFS 1 (RnF FFS)',                              40),
  ('Purnia', 'Packing Line',  'FFS 2 (Prasadam FFS)',                         23.11111111111111),
  ('Purnia', 'Roasting Line', 'Roasting and Flavouring Machine (Old)',        1.5),
  ('Purnia', 'Roasting Line', 'Roasting and Flavouring Machine-Fabcon (New)', 4.166666666666667)
) as v(plant, line, machine, ppm)
join public.plants p on p.name = v.plant
join public.lines l on l.name = v.line
where m.plant_id = p.id and m.line_id = l.id and m.name = v.machine;
