import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import useUserRole from '../hooks/useUserRole'
import { usePageTransition } from '../context/PageTransitionContext'
import { useAuth } from '../context/AuthContext'

function getPageTitle(pathname) {
  if (pathname === '/dashboard') return 'Dashboard'
  if (pathname === '/sessions') return 'Appointments'
  if (pathname === '/reports') return 'Reports & Notes'
  if (pathname === '/resources') return 'Resources & Support'
  if (pathname === '/profile') return 'Profile'
  if (pathname === '/journal') return 'My Journal'
  if (pathname === '/therapist/journal') return 'Journal'
  if (pathname === '/settings') return 'Settings'
  return 'Workspace'
}

export default function Navbar() {
  const location = useLocation()
  const navigate = useNavigate()
  const transition = usePageTransition()
  const { user } = useAuth()
  const { role, uid } = useUserRole()
  const title = useMemo(() => getPageTitle(location.pathname), [location.pathname])
  const roleLabel = role || 'patient'
  const avatarText = user?.displayName ? user.displayName.slice(0, 1).toUpperCase() : 'P'
  const photoUrl = user?.photoURL || ''

  return (
    <nav className="workspace-topbar dashboard-navbar" style={{ overflow: 'visible' }}>
      <div className="workspace-topbar__left dashboard-navbar__left">
        <div className="workspace-topbar__brand">
          <img className="workspace-topbar__brand-logo" src="/logo.jpeg" alt="Serien" />
          <div>
            <h1 className="workspace-topbar__title dashboard-navbar__title sr-only">Serien</h1>
            <p className="workspace-topbar__page-label">{title}</p>
          </div>
        </div>
      </div>

      <div className="workspace-topbar__right dashboard-navbar__right">
        {uid ? (
          <div className="workspace-topbar__identity" aria-label={`Current role: ${roleLabel}`}>
            <span className="workspace-topbar__role-pill">{roleLabel}</span>
            <button
              type="button"
              className="workspace-topbar__avatar"
              aria-label="Open profile"
              onClick={() => {
                if (transition?.navigateWithTransition) {
                  transition.navigateWithTransition('/profile')
                  return
                }
                navigate('/profile')
              }}
            >
              {photoUrl ? (
                <img className="workspace-topbar__avatar-image" src={photoUrl} alt="Profile" referrerPolicy="no-referrer" />
              ) : (
                <span aria-hidden="true">{avatarText}</span>
              )}
            </button>
          </div>
        ) : null}
      </div>
    </nav>
  )
}
