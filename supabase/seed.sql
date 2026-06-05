-- ============================================================================
-- Farmley OEE — seed master data (plants, line types, machines)
-- Run AFTER schema.sql. Safe to re-run (uses upserts on natural keys).
-- ============================================================================

-- Plants ---------------------------------------------------------------------
insert into public.plants (name, sort_order) values
  ('Indore', 1),
  ('Purnia', 2),
  ('Kundli', 3),
  ('UD',     4),
  ('Rebela', 5)
on conflict (name) do update set sort_order = excluded.sort_order;

-- Line types (ONLY these three) ----------------------------------------------
insert into public.lines (name, sort_order) values
  ('Roasting Line', 1),
  ('Packing Line',  2),
  ('Mixing Line',   3)
on conflict (name) do update set sort_order = excluded.sort_order;

-- Machines -------------------------------------------------------------------
-- Helper inserts resolve plant/line by name so this stays readable.
with p as (select id, name from public.plants),
     l as (select id, name from public.lines),
     data(plant_name, line_name, machine_name) as (
       values
         -- Roasting Line
         ('Rebela', 'Roasting Line', 'Dryer 1'),
         ('Kundli', 'Roasting Line', 'Roasting Line 1'),
         ('Indore', 'Roasting Line', 'Oven 1'),
         ('Indore', 'Roasting Line', 'Oven 2'),
         ('UD',     'Roasting Line', 'Dryer 1'),
         ('Purnia', 'Roasting Line', 'Roasting Line 1'),

         -- Packing Line — Indore
         ('Indore', 'Packing Line', 'Conti Mix'),
         ('Indore', 'Packing Line', 'FW'),
         ('Indore', 'Packing Line', 'Jar Sealing'),
         ('Indore', 'Packing Line', 'Jar Sealing - WAD Machine'),
         ('Indore', 'Packing Line', 'LD Pack of 2'),
         ('Indore', 'Packing Line', 'LD Pack of 4'),
         ('Indore', 'Packing Line', 'Pace - FFS'),
         ('Indore', 'Packing Line', 'Perfect - FFS'),
         ('Indore', 'Packing Line', 'PFS'),
         ('Indore', 'Packing Line', 'Table'),
         ('Indore', 'Packing Line', 'Table - Airlines'),

         -- Packing Line — Purnia (Purnea)
         ('Purnia', 'Packing Line', 'Can Seaming 1 (Ashoka 1)'),
         ('Purnia', 'Packing Line', 'Can Seaming 2 (Ashoka 2)'),
         ('Purnia', 'Packing Line', 'Can Seaming 3 (Bubber 1)'),
         ('Purnia', 'Packing Line', 'Can Seaming 4 (Bubber 2)'),
         ('Purnia', 'Packing Line', 'Can Seaming 5 (Bubber 3)'),
         ('Purnia', 'Packing Line', 'FFS1 (RnF)'),
         ('Purnia', 'Packing Line', 'FFS2 (Prasadam)'),

         -- Packing Line — Kundli
         ('Kundli', 'Packing Line', 'FlowWrap Machine 1'),
         ('Kundli', 'Packing Line', 'FlowWrap Machine 2'),
         ('Kundli', 'Packing Line', 'FlowWrap Machine 3'),

         -- Packing Line — UD
         ('UD', 'Packing Line', 'FFS1 (Machine 320mm Former)'),
         ('UD', 'Packing Line', 'FFS2 (Machine 340 mm Former)'),

         -- Packing Line — Rebela
         ('Rebela', 'Packing Line', 'FFS1 (Machine 260 mm Former)'),
         ('Rebela', 'Packing Line', 'FFS2 (Machine 320mm Former)'),
         ('Rebela', 'Packing Line', 'FFS3 (Machine 340 mm Former)'),

         -- Mixing Line — one per plant
         ('Rebela', 'Mixing Line', 'Mixing Line 1'),
         ('Kundli', 'Mixing Line', 'Mixing Line 1'),
         ('Indore', 'Mixing Line', 'Mixing Line 1'),
         ('UD',     'Mixing Line', 'Mixing Line 1'),
         ('Purnia', 'Mixing Line', 'Mixing Line 1')
     )
insert into public.machines (plant_id, line_id, name)
select p.id, l.id, d.machine_name
from data d
join p on p.name = d.plant_name
join l on l.name = d.line_name
on conflict (plant_id, line_id, name) do nothing;
