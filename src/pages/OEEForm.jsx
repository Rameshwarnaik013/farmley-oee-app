import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext.jsx'
import { calculateOEE, hoursToMinutes, formatPct } from '../lib/oee'
import { getMasterPpm } from '../lib/ppmMaster'

// Units by line type: Roasting & Mixing in Kgs, Packing in Pieces.
function unitForLine(lineName) {
  if (!lineName) return 'pieces'
  const n = lineName.toLowerCase()
  if (n.includes('roasting') || n.includes('mixing')) return 'Kgs'
  return 'pieces'
}

// Auto Day/Night shift from current IST time + plant rules.
//  Kundli: 08:00–20:00 IST = Day, else Night.
//  Others: 09:00–19:00 IST = Day, else Night.
function defaultShift(plantName) {
  const istHour = new Date(Date.now() + 5.5 * 3600 * 1000).getUTCHours()
  const isKundli = (plantName || '').toLowerCase() === 'kundli'
  const dayStart = isKundli ? 8 : 9
  const dayEnd = isKundli ? 20 : 19 // exclusive
  return istHour >= dayStart && istHour < dayEnd ? 'Day' : 'Night'
}

const toNumber = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

const targetFromOperationalHours = (hours, ppm) => {
  const target = toNumber(hours) * toNumber(ppm) * 60
  return Math.round(target * 100) / 100
}

export default function OEEForm() {
  const { plantId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [plant, setPlant] = useState(null)
  const [lines, setLines] = useState([])
  const [machines, setMachines] = useState([])
  const [form, setForm] = useState(null) // initialised once plant loads
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  useEffect(() => {
    async function load() {
      const [{ data: pl }, { data: ln }, { data: mc }] = await Promise.all([
        supabase.from('plants').select('*').eq('id', plantId).single(),
        supabase.from('lines').select('*').order('sort_order'),
        supabase
          .from('machines')
          .select('*')
          .eq('plant_id', plantId)
          .eq('is_active', true)
          .order('name'),
      ])
      setPlant(pl)
      setLines(ln ?? [])
      setMachines(mc ?? [])
      setForm({
        line_id: '',
        machine_id: '',
        record_date: new Date().toISOString().slice(0, 10),
        shift: defaultShift(pl?.name),
        planned_time_hours: pl?.default_planned_hours ?? 9, // per-plant default
        downtime_minutes: '',
        actual_output: '',
        target_output: '', // auto-filled from machine
        good_qty: '',
        number_of_cycles: '',
        number_of_tables: '',
        operational_hours: '',
      })
    }
    load()
  }, [plantId])

  const selectedLine = useMemo(
    () => lines.find((l) => l.id === form?.line_id) || null,
    [lines, form?.line_id],
  )
  const selectedMachine = useMemo(
    () => machines.find((m) => m.id === form?.machine_id) || null,
    [machines, form?.machine_id],
  )
  const isRoasting = (selectedLine?.name || '').toLowerCase().includes('roasting')
  const isPacking = (selectedLine?.name || '').toLowerCase().includes('packing')
  const unit = unitForLine(selectedLine?.name)

  // Special case: Indore + Packing Line + "Table" -> Target = 3000 x #tables.
  const TABLE_RATE = 3000
  const isIndoreTable =
    (plant?.name || '') === 'Indore' &&
    isPacking &&
    (selectedMachine?.name || '') === 'Table'
  const baseTargetOutput = isIndoreTable
    ? (form?.number_of_tables === '' ? '' : TABLE_RATE * (Number(form?.number_of_tables) || 0))
    : (selectedMachine?.target_output ?? '')
  const dbPpm = toNumber(selectedMachine?.pieces_per_minute)
  const masterPpm = getMasterPpm(plant?.name, selectedLine?.name, selectedMachine?.name)
  const ppm = dbPpm > 0 ? dbPpm : masterPpm
  const actualExceedsBaseTarget =
    unit === 'pieces' &&
    form?.actual_output !== '' &&
    baseTargetOutput !== '' &&
    toNumber(form?.actual_output) > toNumber(baseTargetOutput)
  const showOperationalHours = actualExceedsBaseTarget || Boolean(form?.operational_hours)

  const lineMachines = useMemo(
    () => machines.filter((m) => m.line_id === form?.line_id),
    [machines, form?.line_id],
  )

  const calc = useMemo(() => (form ? calculateOEE(form) : null), [form])

  const update = (key) => (e) => {
    const value = e.target.value
    setForm((f) => ({ ...f, [key]: value }))
  }

  const onActualOutputChange = (e) => {
    const value = e.target.value
    setForm((f) => {
      const nextActualExceedsTarget =
        unit === 'pieces' &&
        value !== '' &&
        baseTargetOutput !== '' &&
        toNumber(value) > toNumber(baseTargetOutput)

      return {
        ...f,
        actual_output: value,
        operational_hours: nextActualExceedsTarget ? f.operational_hours : '',
        target_output: nextActualExceedsTarget
          ? f.target_output
          : baseTargetOutput,
      }
    })
  }

  const onLineChange = (e) => {
    const line_id = e.target.value
    setForm((f) => ({
      ...f,
      line_id,
      machine_id: '',
      target_output: '',
      number_of_tables: '',
      operational_hours: '',
    }))
  }

  // Selecting a machine auto-fills its Target Output (Per Shift Production).
  // For Indore "Table", target is driven by Number of Tables instead.
  const onMachineChange = (e) => {
    const machine_id = e.target.value
    const m = machines.find((x) => x.id === machine_id)
    const indoreTable =
      (plant?.name || '') === 'Indore' && isPacking && (m?.name || '') === 'Table'
    setForm((f) => ({
      ...f,
      machine_id,
      number_of_tables: '',
      operational_hours: '',
      target_output: indoreTable ? '' : (m?.target_output ?? ''),
    }))
  }

  // Number of Tables -> Target Output = 2500 x tables (Indore Table only).
  const onTablesChange = (e) => {
    const value = e.target.value
    setForm((f) => ({
      ...f,
      number_of_tables: value,
      target_output: value === '' ? '' : TABLE_RATE * (Number(value) || 0),
      operational_hours: '',
    }))
  }

  const onOperationalHoursChange = (e) => {
    const value = e.target.value
    setForm((f) => ({
      ...f,
      operational_hours: value,
      target_output:
        value === '' ? baseTargetOutput : targetFromOperationalHours(value, ppm),
    }))
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setInfo('')

    // ---- Validation ----
    if (!form.line_id) return setError('Please select a line type.')
    if ((isRoasting || isPacking) && !form.machine_id)
      return setError('Machine / sub-line is required for Roasting and Packing lines.')
    if (form.downtime_minutes === '' )
      return setError('Downtime (minutes) is required.')
    if (form.actual_output === '')
      return setError('Actual Output is required.')
    if (form.good_qty === '')
      return setError('Good Qty is required.')
    if (isRoasting && form.number_of_cycles === '')
      return setError('Number of Cycles is required for Roasting Line.')
    if (isIndoreTable && (form.number_of_tables === '' || Number(form.number_of_tables) <= 0))
      return setError('Number of Tables is required for Indore Table (must be > 0).')
    if (actualExceedsBaseTarget && !ppm)
      return setError('Pieces Per Minute (PPM) is missing for the selected machine.')
    if (actualExceedsBaseTarget && (form.operational_hours === '' || Number(form.operational_hours) <= 0))
      return setError('Operational Hours is required when Actual Output is greater than Target Output.')

    setBusy(true)
    const payload = {
      created_by: user.id,
      plant_id: plantId,
      line_id: form.line_id,
      machine_id: form.machine_id || null,
      record_date: form.record_date,
      shift: form.shift || null,
      units: unit === 'pieces' ? 'Pcs' : 'Kgs',
      number_of_cycles: isRoasting ? Number(form.number_of_cycles) || 0 : null,
      operational_hours: showOperationalHours ? Number(form.operational_hours) || 0 : null,
      pieces_per_minute: showOperationalHours ? Number(ppm) || 0 : null,
      planned_time_hours: Number(form.planned_time_hours) || 0,
      downtime_minutes: Number(form.downtime_minutes) || 0,
      actual_output: Number(form.actual_output) || 0,
      target_output: Number(form.target_output) || 0,
      good_qty: Number(form.good_qty) || 0,
      availability_pct: calc.availability_pct,
      performance_pct: calc.performance_pct,
      quality_pct: calc.quality_pct,
      oee_pct: calc.oee_pct,
    }

    const { data, error: insErr } = await supabase
      .from('oee_records')
      .insert(payload)
      .select('id')
      .single()

    if (insErr) {
      setBusy(false)
      return setError(insErr.message)
    }

    try {
      await supabase.functions.invoke('push-to-sheets', { body: { record_id: data.id } })
    } catch {
      /* sheet sync is best-effort */
    }

    setBusy(false)
    setInfo('OEE entry saved.')
    setTimeout(() => navigate(`/plant/${plantId}`), 700)
  }

  if (!plant || !form) return <div className="loading">Loading…</div>

  const outLabel = (base) =>
    unit === 'pieces' ? `${base} (pieces)` : `${base} (Kgs)`

  return (
    <div>
      <Link to={`/plant/${plantId}`} className="back-link">← {plant.name}</Link>
      <h1 className="page-title">New OEE Entry · {plant.name}</h1>
      <p className="page-sub">
        Planned Time defaults to {plant.default_planned_hours}h for {plant.name}.
        Target Output auto-fills from the selected machine.
      </p>

      {error && <div className="msg error">{error}</div>}
      {info && <div className="msg success">{info}</div>}

      <form className="card section" style={{ padding: '1.5rem' }} onSubmit={submit}>
        <div className="form-grid">
          <div>
            <label>Line type *</label>
            <select value={form.line_id} onChange={onLineChange} required>
              <option value="">Select line…</option>
              {lines.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label>
              Machine / sub-line{(isRoasting || isPacking) ? ' *' : ''}
            </label>
            <select
              value={form.machine_id}
              onChange={onMachineChange}
              disabled={!form.line_id}
              required={isRoasting || isPacking}
            >
              <option value="">
                {form.line_id
                  ? (lineMachines.length ? 'Select machine…' : 'No machines for this plant/line')
                  : 'Pick a line first'}
              </option>
              {lineMachines.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label>Date</label>
            <input type="date" value={form.record_date} onChange={update('record_date')} />
          </div>

          <div>
            <label>Planned Time (hours)</label>
            <input
              type="number" min="0" step="any"
              value={form.planned_time_hours}
              onChange={update('planned_time_hours')}
              required
            />
            <small style={{ color: 'var(--muted)' }}>
              = {hoursToMinutes(form.planned_time_hours)} minutes
            </small>
          </div>

          <div>
            <label>Downtime (minutes) [Breakdown] *</label>
            <input
              type="number" min="0" step="any"
              value={form.downtime_minutes}
              onChange={update('downtime_minutes')}
              placeholder="e.g. 30"
              required
            />
          </div>

          <div>
            <label>Shift</label>
            <select value={form.shift} onChange={update('shift')}>
              <option value="Day">Day</option>
              <option value="Night">Night</option>
            </select>
            <small style={{ color: 'var(--muted)' }}>Auto-set by IST time; editable</small>
          </div>

          {isRoasting && (
            <div>
              <label>Number of Cycles *</label>
              <input
                type="number" min="0" step="any"
                value={form.number_of_cycles}
                onChange={update('number_of_cycles')}
                placeholder="e.g. 4"
                required
              />
            </div>
          )}

          {isIndoreTable && (
            <div>
              <label>Number of Tables *</label>
              <input
                type="number" min="1" step="1"
                value={form.number_of_tables}
                onChange={onTablesChange}
                placeholder="e.g. 3"
                required
              />
              <small style={{ color: 'var(--muted)' }}>
                Target = {TABLE_RATE.toLocaleString()} × tables
              </small>
            </div>
          )}

          <div>
            <label>{outLabel('Actual Output')} *</label>
            <input
              type="number" min="0" step="any"
              value={form.actual_output}
              onChange={onActualOutputChange}
              placeholder="e.g. 6500"
              required
            />
          </div>

          {showOperationalHours && (
            <>
              <div>
                <label>Operational Hours *</label>
                <input
                  type="number" min="0" step="any"
                  value={form.operational_hours}
                  onChange={onOperationalHoursChange}
                  placeholder="e.g. 10"
                  required={actualExceedsBaseTarget}
                />
                <small style={{ color: 'var(--muted)' }}>
                  Recalculates target output
                </small>
              </div>

              <div>
                <label>Pieces Per Minute (PPM)</label>
                <input
                  type="number"
                  value={ppm}
                  readOnly
                  placeholder="Not configured"
                  style={{ background: 'var(--bg)' }}
                />
                <small style={{ color: 'var(--muted)' }}>
                  From machine master data
                </small>
              </div>
            </>
          )}

          <div>
            <label>{outLabel('Target Output')} (auto)</label>
            <input
              type="number"
              value={form.target_output}
              readOnly
              placeholder={form.machine_id ? '' : 'Select a machine'}
              style={{ background: 'var(--bg)' }}
            />
            <small style={{ color: 'var(--muted)' }}>
              {isIndoreTable
                ? `${TABLE_RATE.toLocaleString()} × number of tables`
                : 'From machine’s Per Shift Production'}
            </small>
          </div>

          <div>
            <label>{outLabel('Good Qty')} *</label>
            <input
              type="number" min="0" step="any"
              value={form.good_qty}
              onChange={update('good_qty')}
              placeholder="e.g. 5000"
              required
            />
          </div>
        </div>

        <div className="metrics">
          <div className="metric">
            <div className="label">Availability</div>
            <div className="value">{formatPct(calc.availability_pct)}</div>
          </div>
          <div className="metric">
            <div className="label">Performance</div>
            <div className="value">{formatPct(calc.performance_pct)}</div>
          </div>
          <div className="metric">
            <div className="label">Quality</div>
            <div className="value">{formatPct(calc.quality_pct)}</div>
          </div>
          <div className="metric oee">
            <div className="label">OEE</div>
            <div className="value">{formatPct(calc.oee_pct)}</div>
          </div>
        </div>

        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save OEE Entry'}
        </button>
      </form>
    </div>
  )
}
