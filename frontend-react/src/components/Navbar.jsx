import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { onAuthStateChanged } from 'firebase/auth'
import ThemeToggle from './ThemeToggle'
import { getDashboardPath, getUserRole } from '../utils/auth'
import { firebaseAuth } from '../lib/firebase'

export default function Navbar() {
  const location = useLocation()
  const navigate = useNavigate()
  const [role, setRole] = useState('')
  const [hasFirebaseUser, setHasFirebaseUser] = useState(Boolean(firebaseAuth?.currentUser))

  useEffect(() => {
    if (!firebaseAuth) return undefined
    const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
      setHasFirebaseUser(Boolean(user))
      if (!user) {
        setRole('')
        return
      }
      getUserRole(user.uid)
        .then((resolvedRole) => setRole(resolvedRole || ''))
        .catch(() => setRole(''))
    })
    return () => unsubscribe()
  }, [])

  const canAccessDashboard = hasFirebaseUser && Boolean(role)

  function handleHome() {
    if (canAccessDashboard) {
      // Navigate to dashboard if logged in
      navigate(getDashboardPath(role))
    } else {
      // Navigate to landing page if not logged in
      navigate('/')
    }
  }

  function handleDashboard() {
    if (canAccessDashboard) {
      navigate(getDashboardPath(role))
    }
  }

  const isActive = (path) => location.pathname === path

  return (
    <nav className="dashboard-navbar glass" style={{ overflow: 'visible' }}>
      <div className="dashboard-navbar__left">
        <button
          type="button"
          onClick={handleHome}
          className="dashboard-navbar__brand"
        >
          AI Teleconsultation
        </button>
      </div>

      <div className="dashboard-navbar__center">
        <button
          type="button"
          onClick={handleHome}
          className={`dashboard-navbar__chip ${
            (canAccessDashboard ? location.pathname === getDashboardPath(role) : location.pathname === '/')
              ? 'dashboard-navbar__chip--active'
              : ''
          }`}
        >
          Home
        </button>
        {canAccessDashboard ? (
          <button
            type="button"
            onClick={handleDashboard}
            className={`dashboard-navbar__chip ${isActive(getDashboardPath(role)) ? 'dashboard-navbar__chip--active' : ''}`}
          >
            Dashboard
          </button>
        ) : null}
      </div>

      <div className="dashboard-navbar__right">
        <ThemeToggle />
        {hasFirebaseUser ? (
          <button
            type="button"
            onClick={() => navigate('/profile')}
            className="profile-menu__button"
            aria-label="Open profile"
          >
            <span aria-hidden="true">P</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="dashboard-navbar__login"
          >
            Login
          </button>
        )}
      </div>
    </nav>
  )
}
