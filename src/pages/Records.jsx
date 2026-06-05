import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { formatPct } from '../lib/oee'

export default function Records() {
  const [rows, setRows] = useState([])
  const [plants, setPlants] = useState([])
  const [plantFilter, setPlantFilter] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('plants').select('id, name').order('sort_order').then(({ data }) => {
      setPlants(data ?? [])
    })
  }, [])

  useEffect(() => {
    async function load() {
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
      setLoading(false)
    }
    load()
  }, [plantFilter])

  return (
    <div>
      <h1 className="page-title">OEE Records</h1>
      <p className="page-sub">All entries you have access to, newest first.</p>

      <div className="inline-form section" style={{ maxWidth: 320 }}>
        <div style={{ flex: 1 }}>
          <label>Filter by plant</label>
          <select value={plantFilter} onChange={(e) => setPlantFilter(e.target.value)}>
            <option value="">All plants</option>
            {plants.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
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
                  <tr key={r.id}>
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
