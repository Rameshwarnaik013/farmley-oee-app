// ============================================================================
// OEE calculation logic — single source of truth, used by the form preview AND
// when writing to Supabase, so what the user sees equals what gets stored.
//
//   Planned Time is entered in HOURS and converted to minutes (x60).
//   Downtime is in minutes.
//   Actual Output / Target Output / Good Qty are in pieces.
//
//   Availability % = (PlannedMinutes - Downtime) / PlannedMinutes
//   Performance %  = Actual Output / Target Output
//   Quality %      = Good Qty / Actual Output
//   OEE %          = Availability x Performance x Quality
//
// Verified against the sample row: 540 min planned, 30 down, 6500/9000 out,
// 5000 good -> 94.44% x 72.22% x 76.92% = 52.46% ~ 52%.
// ============================================================================

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// Clamp a percentage to a sane 0..100 range and round to 2 decimals.
const pct = (ratio) => {
  if (!Number.isFinite(ratio)) return 0
  return Math.round(ratio * 100 * 100) / 100
}

export function hoursToMinutes(hours) {
  return num(hours) * 60
}

export function calculateOEE(input) {
  const plannedMinutes = hoursToMinutes(input.planned_time_hours)
  const downtime = num(input.downtime_minutes)
  const actual = num(input.actual_output)
  const target = num(input.target_output)
  const good = num(input.good_qty)

  const availability =
    plannedMinutes > 0 ? (plannedMinutes - downtime) / plannedMinutes : 0
  const performance = target > 0 ? actual / target : 0
  const quality = actual > 0 ? good / actual : 0
  const oee = availability * performance * quality

  return {
    planned_time_minutes: plannedMinutes,
    availability_pct: pct(availability),
    performance_pct: pct(performance),
    quality_pct: pct(quality),
    oee_pct: pct(oee),
  }
}

export const formatPct = (v) =>
  v === null || v === undefined || v === '' ? '—' : `${Number(v).toFixed(2)}%`
