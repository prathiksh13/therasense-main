import { Link, useLocation } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { useNavigate } from 'react-router-dom'
import useUserRole from '../hooks/useUserRole'
import usePatientWorkspaceData from '../hooks/usePatientWorkspaceData'
import useTherapistWorkspaceData from '../hooks/useTherapistWorkspaceData'
import { firebaseAuth } from '../lib/firebase'
import { handleJoinCall } from '../utils/sessionCall'

const patientLinks = [
  { to: '/dashboard', label: 'Dashboard', icon: 'grid' },
  { to: '/sessions', label: 'Appointments', icon: 'calendar' },
  { to: '/assignments', label: 'Assignments', icon: 'clipboard' },
  { to: '/reports', label: 'Reports', icon: 'chart' },
  { to: '/journal', label: 'Journal', icon: 'journal' },
  { to: '/resources', label: 'Resources', icon: 'bookmark' },
  { to: '/profile', label: 'Profile', icon: 'profile' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
]

const therapistLinks = [
  { to: '/dashboard', label: 'Dashboard', icon: 'grid' },
  { to: '/sessions', label: 'Appointments', icon: 'calendar' },
  { to: '/assignments', label: 'Assignments', icon: 'clipboard' },
  { to: '/reports', label: 'Reports', icon: 'chart' },
  { to: '/therapist/journal', label: 'Journal', icon: 'journal' },
  { to: '/resources', label: 'Resources', icon: 'bookmark' },
  { to: '/profile', label: 'Profile', icon: 'profile' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
]

function isActivePath(currentPath, targetPath) {
  if (currentPath === targetPath) return true
  if (targetPath === '/therapist') return currentPath.startsWith('/therapist') && currentPath !== '/therapist/journal'
  return currentPath.startsWith(`${targetPath}/`)
}

export default function Sidebar({ open, onClose }) {
  const location = useLocation()
  const { role, uid } = useUserRole()
  const patientData = usePatientWorkspaceData()
  const therapistData = useTherapistWorkspaceData()
  const navigate = useNavigate()
  const navLinks = role === 'therapist' ? therapistLinks : patientLinks

  async function handleLogout() {
    try {
      await signOut(firebaseAuth)
    } catch {
      // ignore
    } finally {
      navigate('/login')
    }
  }

  function normalizeStatus(status = '') {
    const value = String(status || '').toLowerCase()
    if (value === 'accepted') return 'confirmed'
    if (value === 'ongoing' || value === 'live') return 'active'
    if (value === 'done') return 'completed'
    if (value === 'canceled') return 'cancelled'
    return value || 'pending'
  }

  async function handleCallCta() {
    if (role === 'therapist') {
      const activeSession = therapistData.sessions.find((session) => normalizeStatus(session.status) === 'active')
      const confirmedSession = therapistData.sessions.find((session) => normalizeStatus(session.status) === 'confirmed')
      const target = activeSession || confirmedSession

      if (!target) {
        window.alert('No confirmed or active session available right now.')
        return
      }

      if (normalizeStatus(target.status) === 'confirmed' && therapistData.startSession) {
        await therapistData.startSession(target.id)
      }

      await handleJoinCall({
        sessionId: target.id,
        role,
        currentUserId: uid,
        navigate,
      })
      onClose?.()
      return
    }

    const activeSession = patientData.upcomingSessions.find((session) => normalizeStatus(session.status) === 'active')
    if (!activeSession) {
      window.alert('No active session right now. Please wait for your therapist to start.')
      return
    }

    await handleJoinCall({
      sessionId: activeSession.id,
      role,
      currentUserId: uid,
      navigate,
    })
    onClose?.()
  }

  function renderIcon(type) {
    const iconProps = {
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: '1.7',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
    }

    switch (type) {
      case 'calendar':
        return (
          <svg {...iconProps}>
            <rect x="4" y="5" width="16" height="15" rx="3" />
            <path d="M8 3v4M16 3v4M4 10h16" />
          </svg>
        )
      case 'chart':
        return (
          <svg {...iconProps}>
            <path d="M6 3h8l4 4v14H6z" />
            <path d="M14 3v4h4" />
          </svg>
        )
      case 'clipboard':
        return (
          <svg {...iconProps}>
            <rect x="6" y="5" width="12" height="16" rx="2" />
            <path d="M9 5.5h6M9.5 3h5a1 1 0 0 1 1 1v1.5h-7V4a1 1 0 0 1 1-1Z" />
          </svg>
        )
      case 'journal':
        return (
          <svg {...iconProps}>
            <path d="M6 4h10a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
            <path d="M8 8h6M8 12h5M8 16h4" />
          </svg>
        )
      case 'profile':
        return (
          <svg {...iconProps}>
            <circle cx="12" cy="8" r="3" />
            <path d="M6 19c1.5-3 4-4.5 6-4.5s4.5 1.5 6 4.5" />
          </svg>
        )
      case 'bookmark':
        return (
          <svg {...iconProps}>
            <path d="M7 4h10v16l-5-3-5 3z" />
          </svg>
        )
      case 'settings':
        return (
          <svg {...iconProps}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 0 1-1.4 3.4 2 2 0 0 1-1.4-.6l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a2 2 0 0 1-4 0v-.1a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a2 2 0 0 1-2.8 0 2 2 0 0 1 0-2.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a2 2 0 0 1 0-4h.1a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a2 2 0 0 1 0-2.8 2 2 0 0 1 2.8 0l.1.1a1 1 0 0 0 1.1.2H9a1 1 0 0 0 .6-.9V4a2 2 0 0 1 4 0v.1a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a2 2 0 0 1 2.8 0 2 2 0 0 1 0 2.8l-.1.1a1 1 0 0 0-.2 1.1V9a1 1 0 0 0 .9.6H20a2 2 0 0 1 0 4h-.1a1 1 0 0 0-.9.6Z" />
          </svg>
        )
      default:
        return (
          <svg {...iconProps}>
            <path d="M4 6h7v7H4zM13 6h7v4h-7zM13 12h7v6h-7zM4 15h7v3H4z" />
          </svg>
        )
    }
  }

  return (
    <>
      <aside
        className={`workspace-sidebar dashboard-sidebar ${open ? 'is-open dashboard-sidebar-open' : ''}`}
        aria-label="Sidebar"
      >
        <div className="workspace-sidebar__brand dashboard-sidebar__brand">
          <div className="dashboard-sidebar__logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.7A4 4 0 0 1 19 11c0 5.5-7 10-7 10Z" />
            </svg>
          </div>
          <h2 className="workspace-sidebar__title dashboard-sidebar__title">TheraSense</h2>
        </div>

        <nav className="workspace-sidebar__nav dashboard-sidebar__nav">
          {navLinks.map((link) => {
            const isActive = isActivePath(location.pathname, link.to)
            return (
              <Link
                key={link.to}
                to={link.to}
                onClick={onClose}
                className={`workspace-sidebar__link dashboard-sidebar__link ${isActive ? 'workspace-sidebar__link--active dashboard-sidebar__link--active' : ''}`}
              >
                <span className="workspace-sidebar__icon">{renderIcon(link.icon)}</span>
                <span>{link.label}</span>
              </Link>
            )
          })}

          <button
            type="button"
            onClick={handleCallCta}
            className={`workspace-sidebar__link workspace-sidebar__cta ${(location.pathname === '/patient' || location.pathname === '/therapist') ? 'workspace-sidebar__link--active dashboard-sidebar__link--active' : ''}`}
          >
            <span className="workspace-sidebar__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 5h14v14H5z" />
                <path d="m10 9 6 3-6 3z" />
              </svg>
            </span>
            <span>{role === 'therapist' ? 'Start Call' : 'Join Call'}</span>
          </button>
        </nav>

        <div className="workspace-sidebar__footer dashboard-sidebar__footer">
          <button type="button" className="workspace-sidebar__logout" onClick={handleLogout}>
            <span aria-hidden="true" style={{fontSize:'1.1em'}}>&#x21bb;</span>
            Logout
          </button>
        </div>

        <button
          type="button"
          className="workspace-sidebar__resize-handle"
          aria-label="Resize sidebar"
          onMouseDown={(event) => {
            const resizeEvent = new CustomEvent('therasense-sidebar-resize-start', {
              detail: { clientX: event.clientX },
            })
            window.dispatchEvent(resizeEvent)
          }}
        />
      </aside>

      {open ? <button type="button" className="workspace-sidebar__backdrop dashboard-sidebar__backdrop" onClick={onClose} aria-label="Close sidebar" /> : null}
    </>
  )
}
