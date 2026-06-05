import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { formatPct } from '../lib/oee'

export default function PlantModule() {
  const { plantId } = useParams()
  const [plant, setPlant] = useState(null)
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [{ data: pl }, { data: recs }] = await Promise.all([
        supabase.from('plants').select('*').eq('id', plantId).single(),
        supabase
          .from('oee_records')
          .select('*, lines(name), machines(name)')
          .eq('plant_id', plantId)
          .order('created_at', { ascending: false })
          .limit(8),
      ])
      setPlant(pl)
      setRecent(recs ?? [])
      setLoading(false)
    }
    load()
  }, [plantId])

  if (loading) return <div className="loading">Loading…</div>
  if (!plant) return <div className="card muted-box">Plant not found or no access.</div>

  return (
    <div>
      <Link to="/" className="back-link">← All plants</Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">{plant.name}</h1>
          <p className="page-sub">Roasting Line · Packing Line · Mixing Line</p>
        </div>
        <div className="spacer" style={{ flex: 1 }} />
        <Link to={`/plant/${plantId}/entry`}>
          <button className="btn-primary">+ New OEE Entry</button>
        </Link>
      </div>

      <div className="card section" style={{ padding: '1.2rem 1.4rem' }}>
        <h2>Recent entries</h2>
        {recent.length === 0 ? (
          <div className="muted-box">No OEE entries yet for {plant.name}.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Line</th>
                  <th>Machine</th>
                  <th>Avail %</th>
                  <th>Perf %</th>
                  <th>Quality %</th>
                  <th>OEE %</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td>{r.record_date}</td>
                    <td>{r.lines?.name}</td>
                    <td>{r.machines?.name || '—'}</td>
                    <td>{formatPct(r.availability_pct)}</td>
                    <td>{formatPct(r.performance_pct)}</td>
                    <td>{formatPct(r.quality_pct)}</td>
                    <td><strong>{formatPct(r.oee_pct)}</strong></td>
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
