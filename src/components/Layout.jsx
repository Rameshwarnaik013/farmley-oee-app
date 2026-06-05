import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

export default function Layout() {
  const { profile, isAdmin, signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/')
  }

  return (
    <>
      <nav className="navbar">
        <div className="brand">
          <div className="logo">OEE</div>
          <h1>Farmley OEE</h1>
        </div>
        <NavLink to="/" end className="nav-link">Plants</NavLink>
        <NavLink to="/records" className="nav-link">Records</NavLink>
        {isAdmin && <NavLink to="/admin" className="nav-link">Admin</NavLink>}
        <div className="spacer" />
        <span className="user-chip">
          {profile?.email}{isAdmin ? ' · Admin' : ''}
        </span>
        <button className="btn-ghost" onClick={handleSignOut}>Sign out</button>
      </nav>
      <main className="container">
        <Outlet />
      </main>
    </>
  )
}
