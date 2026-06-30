-- ============================================================================
-- Farmley OEE — Add Machine Status + editable-default targets for Indore
-- Run in Supabase SQL Editor (after schema.sql / update_business_rules.sql).
-- Safe to re-run.
-- ============================================================================

-- 1. Machine Status on each OEE record. Defaulted, but the form lets the
--    operator change it per entry. Options used by the app:
--      'Running / Planned for Production' (default)
--      'Not Planned for Production'
alter table public.oee_records
  add column if not exists machine_status text
  default 'Running / Planned for Production';

-- Backfill existing rows that predate the column.
update public.oee_records
set machine_status = 'Running / Planned for Production'
where machine_status is null;

-- 2. Editable-default Target Output (Per Shift Production) for Indore machines.
--    These values auto-fill in the form but stay editable per entry.
--      Mixing Line / Mixing Line 1 -> 4200 Kgs
--      Roasting Line / Oven1, Oven2 -> 3000 Kgs each
update public.machines m
set target_output = v.target
from (values
  ('Indore', 'Mixing Line',   'Mixing Line 1', 4200),
  ('Indore', 'Roasting Line', 'Oven1',         3000),
  ('Indore', 'Roasting Line', 'Oven2',         3000)
) as v(plant, line, machine, target)
join public.plants p on p.name = v.plant
join public.lines  l on l.name = v.line
where m.plant_id = p.id and m.line_id = l.id and m.name = v.machine;
