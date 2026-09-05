import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext.jsx'
import { calculateOEE, formatPct } from '../lib/oee'
import {
  MACHINE_STATUS_RUNNING,
  MACHINE_STATUS_NOT_PLANNED,
} from '../lib/machineStatusDefaults'

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.45)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: '2rem 1rem',
  overflowY: 'auto',
  zIndex: 50,
}
const modalStyle = {
  background: 'var(--card, #ffffff)',
  borderRadius: 12,
  padding: '1.4rem 1.5rem',
  width: 'min(760px, 100%)',
  boxShadow: '0 12px 48px rgba(0,0,0,0.28)',
}

const MACHINE_STATUS_OPTIONS = [MACHINE_STATUS_RUNNING, MACHINE_STATUS_NOT_PLANNED]

export default function Records() {
  const { isAdmin } = useAuth()
  const [rows, setRows] = useState([])
  const [plants, setPlants] = useState([])
  const [plantFilter, setPlantFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState({}) // id -> true
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  // Edit modal state
  const [editing, setEditing] = useState(null) // the row being edited
  const [editForm, setEditForm] = useState(null)
  const [editBusy, setEditBusy] = useState(false)
  const [editErr, setEditErr] = useState('')

  useEffect(() => {
    supabase.from('plants').select('id, name').order('sort_order').then(({ data }) => {
      setPlants(data ?? [])
    })
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('oee_records')
      .select('*, plants(name), lines(name), machines(name)')
      .order('record_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200)
    if (plantFilter) q = q.eq('plant_id', plantFilter)
    const { data } = await q
    setRows(data ?? [])
    setSelected({})
    setLoading(false)
  }, [plantFilter])

  useEffect(() => { load() }, [load])

  const selectedIds = Object.keys(selected).filter((id) => selected[id])
  const allChecked = rows.length > 0 && selectedIds.length === rows.length

  const toggleRow = (id) =>
    setSelected((s) => ({ ...s, [id]: !s[id] }))

  const toggleAll = () => {
    if (allChecked) return setSelected({})
    const next = {}
    rows.forEach((r) => { next[r.id] = true })
    setSelected(next)
  }

  const deleteSelected = async () => {
    if (selectedIds.length === 0) return
    const ok = window.confirm(
      `Permanently delete ${selectedIds.length} record(s)? This cannot be undone.`,
    )
    if (!ok) return
    setBusy(true)
    setMsg('')
    const { error } = await supabase.from('oee_records').delete().in('id', selectedIds)
    setBusy(false)
    if (error) return setMsg(error.message)
    setMsg(`Deleted ${selectedIds.length} record(s).`)
    await load()
  }

  // ---- Edit ----
  const openEdit = (r) => {
    setEditErr('')
    setEditing(r)
    setEditForm({
      record_date: r.record_date || '',
      shift: r.shift || 'Day',
      machine_status: r.machine_status || MACHINE_STATUS_RUNNING,
      planned_time_hours: r.planned_time_hours ?? '',
      downtime_minutes: r.downtime_minutes ?? '',
      operational_hours: r.operational_hours ?? '',
      pieces_per_minute: r.pieces_per_minute ?? '',
      number_of_cycles: r.number_of_cycles ?? '',
      actual_output: r.actual_output ?? '',
      target_output: r.target_output ?? '',
      good_qty: r.good_qty ?? '',
    })
  }
  const closeEdit = () => { setEditing(null); setEditForm(null); setEditErr('') }
  const editField = (key) => (e) =>
    setEditForm((f) => ({ ...f, [key]: e.target.value }))

  const editCalc = editForm ? calculateOEE(editForm) : null

  const saveEdit = async () => {
    setEditErr('')
    if (!editForm.record_date) return setEditErr('Date is required.')
    const num = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v))
    const nn = (v) => (v === '' || v === null || v === undefined ? null : Number(v))
    const calc = calculateOEE(editForm)
    setEditBusy(true)
    const patch = {
      record_date: editForm.record_date,
      shift: editForm.shift || null,
      machine_status: editForm.machine_status || null,
      planned_time_hours: num(editForm.planned_time_hours),
      downtime_minutes: num(editForm.downtime_minutes),
      operational_hours: nn(editForm.operational_hours),
      pieces_per_minute: nn(editForm.pieces_per_minute),
      number_of_cycles: nn(editForm.number_of_cycles),
      actual_output: num(editForm.actual_output),
      target_output: num(editForm.target_output),
      good_qty: num(editForm.good_qty),
      availability_pct: calc.availability_pct,
      performance_pct: calc.performance_pct,
      quality_pct: calc.quality_pct,
      oee_pct: calc.oee_pct,
      synced_to_sheet: false, // re-synced to the Sheet on the next pull
    }
    const { error } = await supabase.from('oee_records').update(patch).eq('id', editing.id)
    setEditBusy(false)
    if (error) {
      if (error.code === '23505')
        return setEditErr('This edit would exactly duplicate another entry. Change a value or delete the other row.')
      return setEditErr(error.message)
    }
    setMsg('Entry updated. The Google Sheet refreshes on the next sync.')
    closeEdit()
    await load()
  }

  return (
    <div>
      <h1 className="page-title">OEE Records</h1>
      <p className="page-sub">
        All entries you have access to, newest first.
        {isAdmin && ' As admin, edit a row to fix mistakes, or tick rows to delete them.'}
      </p>

      {msg && <div className="msg success" style={{ maxWidth: 560 }}>{msg}</div>}

      <div
        className="section"
        style={{ display: 'flex', alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap' }}
      >
        <div style={{ minWidth: 240 }}>
          <label>Filter by plant</label>
          <select value={plantFilter} onChange={(e) => setPlantFilter(e.target.value)}>
            <option value="">All plants</option>
            {plants.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {isAdmin && (
          <button
            className="btn-danger"
            onClick={deleteSelected}
            disabled={busy || selectedIds.length === 0}
          >
            {busy ? 'Deleting…' : `Delete selected (${selectedIds.length})`}
          </button>
        )}
      </div>

      <div className="card" style={{ padding: '0.4rem 0.6rem' }}>
        {loading ? (
          <div className="muted-box">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="muted-box">No records found.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {isAdmin && (
                    <th style={{ width: 32 }}>
                      <input
                        type="checkbox"
                        style={{ width: 'auto' }}
                        checked={allChecked}
                        onChange={toggleAll}
                        title="Select all"
                      />
                    </th>
                  )}
                  {isAdmin && <th>Edit</th>}
                  <th>Code</th>
                  <th>Date</th>
                  <th>Plant</th>
                  <th>Line</th>
                  <th>Machine</th>
                  <th>Status</th>
                  <th>Planned (min)</th>
                  <th>Downtime</th>
                  <th>Op Hours</th>
                  <th>PPM</th>
                  <th>Actual</th>
                  <th>Target</th>
                  <th>Good</th>
                  <th>Avail %</th>
                  <th>Perf %</th>
                  <th>Qual %</th>
                  <th>OEE %</th>
                  <th>Sheet</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    style={selected[r.id] ? { background: '#fef2f2' } : undefined}
                  >
                    {isAdmin && (
                      <td>
                        <input
                          type="checkbox"
                          style={{ width: 'auto' }}
                          checked={!!selected[r.id]}
                          onChange={() => toggleRow(r.id)}
                        />
                      </td>
                    )}
                    {isAdmin && (
                      <td>
                        <button
                          className="btn-ghost"
                          style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}
                          onClick={() => openEdit(r)}
                        >
                          Edit
                        </button>
                      </td>
                    )}
                    <td title={r.row_code || ''} style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                      {r.row_code ? r.row_code.slice(0, 8) : '—'}
                    </td>
                    <td>{r.record_date}</td>
                    <td>{r.plants?.name}</td>
                    <td>{r.lines?.name}</td>
                    <td>{r.machines?.name || '—'}</td>
                    <td>{r.machine_status || '—'}</td>
                    <td>{r.planned_time_minutes}</td>
                    <td>{r.downtime_minutes}</td>
                    <td>{r.operational_hours ?? '-'}</td>
                    <td>{r.pieces_per_minute ?? '-'}</td>
                    <td>{r.actual_output}</td>
                    <td>{r.target_output}</td>
                    <td>{r.good_qty}</td>
                    <td>{formatPct(r.availability_pct)}</td>
                    <td>{formatPct(r.performance_pct)}</td>
                    <td>{formatPct(r.quality_pct)}</td>
                    <td><strong>{formatPct(r.oee_pct)}</strong></td>
                    <td>
                      <span className={`badge ${r.synced_to_sheet ? 'green' : 'gray'}`}>
                        {r.synced_to_sheet ? 'Synced' : 'Pending'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && editForm && (
        <div style={overlayStyle} onClick={() => !editBusy && closeEdit()}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Edit OEE entry</h2>
            <p className="page-sub" style={{ marginTop: 0 }}>
              {editing.plants?.name} · {editing.lines?.name}
              {editing.machines?.name ? ` · ${editing.machines.name}` : ''}
              <br />
              <small style={{ color: 'var(--muted)' }}>
                Plant / line / machine can't be changed here — delete and re-enter if those are wrong.
              </small>
            </p>

            {editErr && <div className="msg error">{editErr}</div>}

            <div className="form-grid">
              <div>
                <label>Date *</label>
                <input type="date" value={editForm.record_date} onChange={editField('record_date')} />
              </div>
              <div>
                <label>Shift</label>
                <select value={editForm.shift} onChange={editField('shift')}>
                  <option value="Day">Day</option>
                  <option value="Night">Night</option>
                </select>
              </div>
              <div>
                <label>Machine Status</label>
                <select value={editForm.machine_status} onChange={editField('machine_status')}>
                  {MACHINE_STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Planned Time (hours)</label>
                <input type="number" min="0" step="any" value={editForm.planned_time_hours} onChange={editField('planned_time_hours')} />
              </div>
              <div>
                <label>Downtime (minutes)</label>
                <input type="number" min="0" step="any" value={editForm.downtime_minutes} onChange={editField('downtime_minutes')} />
              </div>
              <div>
                <label>Operational Hours</label>
                <input type="number" min="0" step="any" value={editForm.operational_hours} onChange={editField('operational_hours')} placeholder="—" />
              </div>
              <div>
                <label>Pieces Per Minute (PPM)</label>
                <input type="number" min="0" step="any" value={editForm.pieces_per_minute} onChange={editField('pieces_per_minute')} placeholder="—" />
              </div>
              <div>
                <label>Number of Cycles</label>
                <input type="number" min="0" step="any" value={editForm.number_of_cycles} onChange={editField('number_of_cycles')} placeholder="—" />
              </div>
              <div>
                <label>Actual Output</label>
                <input type="number" min="0" step="any" value={editForm.actual_output} onChange={editField('actual_output')} />
              </div>
              <div>
                <label>Target Output</label>
                <input type="number" min="0" step="any" value={editForm.target_output} onChange={editField('target_output')} />
              </div>
              <div>
                <label>Good Qty</label>
                <input type="number" min="0" step="any" value={editForm.good_qty} onChange={editField('good_qty')} />
              </div>
            </div>

            {editCalc && (
              <div className="metrics" style={{ marginTop: '1rem' }}>
                <div className="metric">
                  <div className="label">Availability</div>
                  <div className="value">{formatPct(editCalc.availability_pct)}</div>
                </div>
                <div className="metric">
                  <div className="label">Performance</div>
                  <div className="value">{formatPct(editCalc.performance_pct)}</div>
                </div>
                <div className="metric">
                  <div className="label">Quality</div>
                  <div className="value">{formatPct(editCalc.quality_pct)}</div>
                </div>
                <div className="metric oee">
                  <div className="label">OEE</div>
                  <div className="value">{formatPct(editCalc.oee_pct)}</div>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1.2rem' }}>
              <button className="btn-primary" onClick={saveEdit} disabled={editBusy}>
                {editBusy ? 'Saving…' : 'Save changes'}
              </button>
              <button className="btn-ghost" onClick={closeEdit} disabled={editBusy}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
