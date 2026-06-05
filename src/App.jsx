import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import { isSupabaseConfigured } from './lib/supabaseClient'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import PlantModule from './pages/PlantModule.jsx'
import OEEForm from './pages/OEEForm.jsx'
import Records from './pages/Records.jsx'
import Admin from './pages/Admin.jsx'
import Layout from './components/Layout.jsx'

function ConfigNeeded() {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand">
          <div className="logo">OEE</div>
          <h1>Farmley OEE</h1>
        </div>
        <div className="msg error">
          Supabase is not configured. Copy <code>.env.example</code> to{' '}
          <code>.env</code>, fill in <code>VITE_SUPABASE_URL</code> and{' '}
          <code>VITE_SUPABASE_ANON_KEY</code>, then restart the dev server.
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const { session, loading } = useAuth()

  if (!isSupabaseConfigured) return <ConfigNeeded />
  if (loading) return <div className="loading">Loading…</div>
  if (!session) return <Login />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/plant/:plantId" element={<PlantModule />} />
        <Route path="/plant/:plantId/entry" element={<OEEForm />} />
        <Route path="/records" element={<Records />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
