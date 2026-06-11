import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext.jsx'
import { formatPct } from '../lib/oee'

export default function Records() {
  const { isAdmin } = useAuth()
  const [rows, setRows] = useState([])
  const [plants, setPlants] = useState([])
  const [plantFilter, setPlantFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState({}) // id -> true
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

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

  return (
    <div>
      <h1 className="page-title">OEE Records</h1>
      <p className="page-sub">
        All entries you have access to, newest first.
        {isAdmin && ' As admin, tick rows to delete wrongly-filled entries.'}
      </p>

      {msg && <div className="msg success" style={{ maxWidth: 480 }}>{msg}</div>}

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
                  <th>Date</th>
                  <th>Plant</th>
                  <th>Line</th>
                  <th>Machine</th>
                  <th>Planned (min)</th>
                  <th>Downtime</th>
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
                    <td>{r.record_date}</td>
                    <td>{r.plants?.name}</td>
                    <td>{r.lines?.name}</td>
                    <td>{r.machines?.name || '—'}</td>
                    <td>{r.planned_time_minutes}</td>
                    <td>{r.downtime_minutes}</td>
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
    </div>
  )
}
