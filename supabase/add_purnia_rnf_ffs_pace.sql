-- ============================================================================
-- Farmley OEE — Add Purnia (Purnea) Packing Line machine "RnF FFS - Pace"
-- Run in Supabase SQL Editor. Safe to re-run.
--
-- PPM = 80 pieces/min. Purnia runs a 9-hour shift (540 min), so
-- Target Output (Per Shift Production) = 80 * 9 * 60 = 43200 pieces.
-- ============================================================================

with p as (select id from public.plants where name = 'Purnia'),
     l as (select id from public.lines  where name = 'Packing Line')
insert into public.machines (plant_id, line_id, name, target_output, pieces_per_minute, units, is_active)
select p.id, l.id, 'RnF FFS - Pace', 43200, 80, 'Pcs', true
from p cross join l
on conflict (plant_id, line_id, name)
  do update set target_output     = excluded.target_output,
                pieces_per_minute = excluded.pieces_per_minute,
                units             = excluded.units,
                is_active         = true;
