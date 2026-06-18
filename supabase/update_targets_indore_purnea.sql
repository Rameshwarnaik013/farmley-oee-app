-- ============================================================================
-- Farmley OEE — Update Per Shift Production (Target Output) for specific
-- Indore + Purnea machines. Run in Supabase SQL Editor. Safe to re-run.
-- ============================================================================

alter table public.machines add column if not exists pieces_per_minute numeric;
alter table public.oee_records add column if not exists operational_hours numeric;
alter table public.oee_records add column if not exists pieces_per_minute numeric;

update public.machines m
set target_output = v.target,
    pieces_per_minute = v.ppm
from (values
  ('Indore', 'Packing Line',  'FlowWrap',                                    75600, 210.18333333333334),
  ('Indore', 'Packing Line',  'Pace - FFS',                                  33600, 62.22222222222222),
  ('Indore', 'Packing Line',  'Perfect - FFS',                               18900, 35),
  ('Indore', 'Packing Line',  'PFS1',                                        12000, 22.22222222222222),
  ('Indore', 'Packing Line',  'PFS2',                                        12000, 22.22222222222222),
  ('Indore', 'Packing Line',  'PFS3',                                        10500, 19.444444444444446),
  ('Indore', 'Packing Line',  'Jar Sealing - WAD Machine',                   3000, 4.62962962962963),
  ('Purnia', 'Roasting Line', 'Roasting and Flavouring Machine (Old)',       810, 1.5),
  ('Purnia', 'Roasting Line', 'Roasting and Flavouring Machine-Fabcon (New)', 2250, 4.166666666666667),
  ('Indore', 'Packing Line',  'Table',                                       3000, 4.62962962962963)
) as v(plant, line, machine, target, ppm)
join public.plants p on p.name = v.plant
join public.lines  l on l.name = v.line
where m.plant_id = p.id and m.line_id = l.id and m.name = v.machine;

with p as (select id from public.plants where name = 'Indore'),
     l as (select id from public.lines where name = 'Packing Line')
insert into public.machines (plant_id, line_id, name, target_output, pieces_per_minute, units, is_active)
select p.id, l.id, 'PFS3', 10500, 19.444444444444446, 'Pcs', true
from p cross join l
on conflict (plant_id, line_id, name)
  do update set target_output = excluded.target_output,
                pieces_per_minute = excluded.pieces_per_minute,
                units = excluded.units,
                is_active = true;

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
