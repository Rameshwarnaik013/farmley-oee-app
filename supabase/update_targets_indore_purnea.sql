-- ============================================================================
-- Farmley OEE — Update Per Shift Production (Target Output) for specific
-- Indore + Purnea machines. Run in Supabase SQL Editor. Safe to re-run.
-- ============================================================================

update public.machines m
set target_output = v.target
from (values
  ('Indore', 'Packing Line',  'FlowWrap',                                    75600),
  ('Indore', 'Packing Line',  'Pace - FFS',                                  33600),
  ('Indore', 'Packing Line',  'Perfect - FFS',                               18900),
  ('Indore', 'Packing Line',  'PFS1',                                        12000),
  ('Indore', 'Packing Line',  'PFS2',                                        12000),
  ('Indore', 'Packing Line',  'PFS3',                                        10500),
  ('Indore', 'Packing Line',  'Jar Sealing - WAD Machine',                   3000),
  ('Purnia', 'Roasting Line', 'Roasting and Flavouring Machine (Old)',       810),
  ('Purnia', 'Roasting Line', 'Roasting and Flavouring Machine-Fabcon (New)', 2250),
  ('Indore', 'Packing Line',  'Table',                                       3000)
) as v(plant, line, machine, target)
join public.plants p on p.name = v.plant
join public.lines  l on l.name = v.line
where m.plant_id = p.id and m.line_id = l.id and m.name = v.machine;

with p as (select id from public.plants where name = 'Indore'),
     l as (select id from public.lines where name = 'Packing Line')
insert into public.machines (plant_id, line_id, name, target_output, units, is_active)
select p.id, l.id, 'PFS3', 10500, 'Pcs', true
from p cross join l
on conflict (plant_id, line_id, name)
  do update set target_output = excluded.target_output,
                units = excluded.units,
                is_active = true;
