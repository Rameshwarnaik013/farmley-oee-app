import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext.jsx'
import { calculateOEE, hoursToMinutes, formatPct } from '../lib/oee'

const EMPTY = {
  line_id: '',
  machine_id: '',
  record_date: new Date().toISOString().slice(0, 10),
  shift: '',
  planned_time_hours: '',
  downtime_minutes: '',
  actual_output: '',
  target_output: '',
  good_qty: '',
}

export default function OEEForm() {
  const { plantId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [plant, setPlant] = useState(null)
  const [lines, setLines] = useState([])
  const [machines, setMachines] = useState([])
  const [form, setForm] = useState(EMPTY)
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
    }
    load()
  }, [plantId])

  // Machines filtered by the chosen line type (only this plant's machines).
  const lineMachines = useMemo(
    () => machines.filter((m) => m.line_id === form.line_id),
    [machines, form.line_id],
  )

  // Live OEE preview — same logic that gets stored.
  const calc = useMemo(() => calculateOEE(form), [form])

  const update = (key) => (e) => {
    const value = e.target.value
    setForm((f) => ({
      ...f,
      [key]: value,
      // reset machine when line changes
      ...(key === 'line_id' ? { machine_id: '' } : {}),
    }))
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setInfo('')

    if (!form.line_id) return setError('Please select a line type.')

    setBusy(true)
    const payload = {
      created_by: user.id,
      plant_id: plantId,
      line_id: form.line_id,
      machine_id: form.machine_id || null,
      record_date: form.record_date,
      shift: form.shift || null,
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

    // Push the saved row to Google Sheets (server-side edge function).
    // Failure here does NOT lose the record — it's safely in Supabase.
    try {
      await supabase.functions.invoke('push-to-sheets', {
        body: { record_id: data.id },
      })
    } catch {
      /* sheet sync is best-effort; ignore network errors */
    }

    setBusy(false)
    setInfo('OEE entry saved.')
    setForm(EMPTY)
    setTimeout(() => navigate(`/plant/${plantId}`), 700)
  }

  if (!plant) return <div className="loading">Loading…</div>

  return (
    <div>
      <Link to={`/plant/${plantId}`} className="back-link">← {plant.name}</Link>
      <h1 className="page-title">New OEE Entry · {plant.name}</h1>
      <p className="page-sub">
        Planned Time is entered in <strong>hours</strong> and auto-converts to minutes.
        Downtime in minutes. Outputs in pieces.
      </p>

      {error && <div className="msg error">{error}</div>}
      {info && <div className="msg success">{info}</div>}

      <form className="card section" style={{ padding: '1.5rem' }} onSubmit={submit}>
        <div className="form-grid">
          <div>
            <label>Line type</label>
            <select value={form.line_id} onChange={update('line_id')} required>
              <option value="">Select line…</option>
              {lines.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label>Machine / sub-line</label>
            <select
              value={form.machine_id}
              onChange={update('machine_id')}
              disabled={!form.line_id}
            >
              <option value="">
                {form.line_id ? 'Select machine…' : 'Pick a line first'}
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
              placeholder="e.g. 9"
              required
            />
            <small style={{ color: 'var(--muted)' }}>
              = {hoursToMinutes(form.planned_time_hours)} minutes
            </small>
          </div>

          <div>
            <label>Downtime (minutes)</label>
            <input
              type="number" min="0" step="any"
              value={form.downtime_minutes}
              onChange={update('downtime_minutes')}
              placeholder="e.g. 30"
            />
          </div>

          <div>
            <label>Shift (optional)</label>
            <input type="text" value={form.shift} onChange={update('shift')} placeholder="A / B / C" />
          </div>

          <div>
            <label>Actual Output (pieces)</label>
            <input
              type="number" min="0" step="any"
              value={form.actual_output}
              onChange={update('actual_output')}
              placeholder="e.g. 6500"
            />
          </div>

          <div>
            <label>Target Output (pieces)</label>
            <input
              type="number" min="0" step="any"
              value={form.target_output}
              onChange={update('target_output')}
              placeholder="e.g. 9000"
            />
          </div>

          <div>
            <label>Good Qty (pieces)</label>
            <input
              type="number" min="0" step="any"
              value={form.good_qty}
              onChange={update('good_qty')}
              placeholder="e.g. 5000"
            />
          </div>
        </div>

        {/* Live calculated metrics */}
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
