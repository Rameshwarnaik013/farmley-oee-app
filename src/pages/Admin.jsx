import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext.jsx'

export default function Admin() {
  const { isAdmin } = useAuth()
  const [users, setUsers] = useState([])
  const [plants, setPlants] = useState([])
  const [assignments, setAssignments] = useState({}) // userId -> Set(plantId)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const [{ data: profs }, { data: pls }, { data: ups }] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at'),
      supabase.from('plants').select('*').order('sort_order'),
      supabase.from('user_plants').select('*'),
    ])
    setUsers(profs ?? [])
    setPlants(pls ?? [])
    const map = {}
    ;(ups ?? []).forEach((r) => {
      ;(map[r.user_id] ??= new Set()).add(r.plant_id)
    })
    setAssignments(map)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const togglePlant = async (userId, plantId) => {
    const has = assignments[userId]?.has(plantId)
    setMsg('')
    if (has) {
      await supabase.from('user_plants').delete().eq('user_id', userId).eq('plant_id', plantId)
    } else {
      await supabase.from('user_plants').insert({ user_id: userId, plant_id: plantId })
    }
    await load()
  }

  const setRole = async (userId, role) => {
    setMsg('')
    const { error } = await supabase.from('profiles').update({ role }).eq('id', userId)
    if (error) setMsg(error.message)
    await load()
  }

  if (!isAdmin) return <div className="card muted-box">Admins only.</div>
  if (loading) return <div className="loading">Loading users…</div>

  return (
    <div>
      <h1 className="page-title">Admin · User Access</h1>
      <p className="page-sub">
        Assign plants to each user and manage roles. Admins can access all plants.
      </p>
      {msg && <div className="msg error">{msg}</div>}

      <div className="card" style={{ padding: '0.4rem 0.6rem' }}>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                {plants.map((p) => (
                  <th key={p.id} style={{ textAlign: 'center' }}>{p.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{u.full_name || '—'}</div>
                    <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>{u.email}</div>
                  </td>
                  <td>
                    <select value={u.role} onChange={(e) => setRole(u.id, e.target.value)}>
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  {plants.map((p) => {
                    const checked = u.role === 'admin' || assignments[u.id]?.has(p.id)
                    return (
                      <td key={p.id} style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          style={{ width: 'auto' }}
                          checked={!!checked}
                          disabled={u.role === 'admin'}
                          onChange={() => togglePlant(u.id, p.id)}
                          title={u.role === 'admin' ? 'Admins access all plants' : ''}
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="page-sub" style={{ marginTop: '1.2rem', fontSize: '0.85rem' }}>
        Tip: to create the first admin, sign up normally, then in Supabase run{' '}
        <code>update public.profiles set role='admin' where email='you@farmley.com';</code>
      </p>
    </div>
  )
}
