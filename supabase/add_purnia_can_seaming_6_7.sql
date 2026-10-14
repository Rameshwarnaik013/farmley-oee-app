-- ============================================================================
-- Farmley OEE — Add Purnia (Purnea) Packing Line machines
--   "Can Seaming 6 (Ashoka 3)" and "Can Seaming 7 (Ashoka 4)"
-- Run in Supabase SQL Editor. Safe to re-run.
--
-- Same Ashoka seamer as Can Seaming 1/2 (Ashoka 1/2), so same rate:
-- PPM = 35.56 pieces/min. Purnia runs a 9-hour shift (540 min), so
-- Target Output (Per Shift Production) = 19200 pieces.
-- ============================================================================

with p as (select id from public.plants where name = 'Purnia'),
     l as (select id from public.lines  where name = 'Packing Line'),
     data(machine_name, target, ppm) as (
       values
         ('Can Seaming 6 (Ashoka 3)', 19200, 35.55555555555556),
         ('Can Seaming 7 (Ashoka 4)', 19200, 35.55555555555556)
     )
insert into public.machines (plant_id, line_id, name, target_output, pieces_per_minute, units, is_active)
select p.id, l.id, d.machine_name, d.target, d.ppm, 'Pcs', true
from data d cross join p cross join l
on conflict (plant_id, line_id, name)
  do update set target_output     = excluded.target_output,
                pieces_per_minute = excluded.pieces_per_minute,
                units             = excluded.units,
                is_active         = true;
