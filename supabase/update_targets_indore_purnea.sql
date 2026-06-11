-- ============================================================================
-- Farmley OEE — Update Per Shift Production (Target Output) for specific
-- Indore + Purnea machines. Run in Supabase SQL Editor. Safe to re-run.
-- ============================================================================

update public.machines m
set target_output = v.target
from (values
  ('Indore', 'Packing Line',  'FlowWrap',                                    75600),
  ('Indore', 'Packing Line',  'PFS1',                                        12000),
  ('Indore', 'Packing Line',  'PFS2',                                        12000),
  ('Indore', 'Packing Line',  'Jar Sealing - WAD Machine',                   2500),
  ('Purnia', 'Roasting Line', 'Roasting and Flavouring Machine (Old)',       810),
  ('Purnia', 'Roasting Line', 'Roasting and Flavouring Machine-Fabcon (New)', 2250)
) as v(plant, line, machine, target)
join public.plants p on p.name = v.plant
join public.lines  l on l.name = v.line
where m.plant_id = p.id and m.line_id = l.id and m.name = v.machine;
