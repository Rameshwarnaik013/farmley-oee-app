import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext.jsx'

export default function Dashboard() {
  const { profile, isAdmin } = useAuth()
  const [plants, setPlants] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // RLS already limits readable plants for non-admins via accessible records,
    // but plants are world-readable, so we additionally filter by assignment.
    async function load() {
      const { data: allPlants } = await supabase
        .from('plants')
        .select('*')
        .order('sort_order')

      if (isAdmin) {
        setPlants(allPlants ?? [])
      } else {
        const { data: mine } = await supabase
          .from('user_plants')
          .select('plant_id')
        const allowed = new Set((mine ?? []).map((r) => r.plant_id))
        setPlants((allPlants ?? []).filter((p) => allowed.has(p.id)))
      }
      setLoading(false)
    }
    load()
  }, [isAdmin])

  if (loading) return <div className="loading">Loading plants…</div>

  return (
    <div>
      <h1 className="page-title">Plant Modules</h1>
      <p className="page-sub">
        Welcome{profile?.full_name ? `, ${profile.full_name}` : ''}. Select a plant to
        record OEE.
      </p>

      {plants.length === 0 ? (
        <div className="card muted-box">
          {isAdmin
            ? 'No plants found. Run seed.sql in Supabase to load the 5 plants.'
            : 'No plants assigned to you yet. Ask an admin to assign your plant(s).'}
        </div>
      ) : (
        <div className="plant-grid">
          {plants.map((p) => (
            <Link key={p.id} to={`/plant/${p.id}`} className="card plant-card">
              <div className="pc-icon">{p.name.slice(0, 2).toUpperCase()}</div>
              <h3>{p.name}</h3>
              <p>Record OEE for this plant</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
