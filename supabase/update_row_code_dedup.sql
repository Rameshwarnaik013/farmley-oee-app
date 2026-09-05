-- ============================================================================
-- Farmley OEE — Unique row code + de-duplication
-- Run in Supabase SQL Editor (after the other migrations). Safe to re-run.
--
-- Each OEE record gets a deterministic `row_code` (md5 of its identifying
-- fields). Two rows with EXACTLY the same values get the same code, and a
-- unique index then makes exact duplicates impossible — the second insert is
-- rejected instead of stored. The code is recomputed whenever a row is edited.
-- ============================================================================

alter table public.oee_records add column if not exists row_code text;

-- Fingerprint = md5 over the fields that define an entry. created_by / created_at
-- / id are intentionally excluded, so the same data entered twice = a duplicate.
create or replace function public.oee_row_code()
returns trigger
language plpgsql
as $$
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
$$;

drop trigger if exists oee_row_code_trg on public.oee_records;
create trigger oee_row_code_trg
  before insert or update on public.oee_records
  for each row execute function public.oee_row_code();

-- Backfill existing rows: the UPDATE fires the trigger, which fills row_code.
update public.oee_records set row_code = null;

-- Remove existing exact duplicates, keeping the earliest of each group.
with ranked as (
  select id,
         row_number() over (partition by row_code order by created_at, id) as rn
  from public.oee_records
)
delete from public.oee_records o
using ranked r
where o.id = r.id and r.rn > 1;

-- Enforce uniqueness so future exact duplicates cannot be inserted.
create unique index if not exists oee_records_row_code_uidx
  on public.oee_records (row_code);

-- Note: the existing "oee update" RLS policy already lets admins (and any user
-- with plant access) update rows, so admin editing needs no policy change.
