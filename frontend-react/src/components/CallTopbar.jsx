import { useNavigate } from 'react-router-dom'

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
    </svg>
  )
}

export default function CallTopbar({
  role = 'patient',
  title,
  subtitle = 'TheraSense Live',
  actionLabel,
  onAction,
  actionDisabled = false,
}) {
  const navigate = useNavigate()
  const isTherapist = role === 'therapist'

  return (
    <header className="call-topbar dark-surface">
      <div className="call-topbar__left">
        <button
          type="button"
          className="call-topbar__back"
          onClick={() => navigate('/dashboard')}
          aria-label="Back to dashboard"
        >
          <ChevronLeftIcon />
        </button>
        <div>
          <p className="call-topbar__eyebrow">{subtitle}</p>
          <h1 className="call-topbar__title">{title || (isTherapist ? 'Therapist Dashboard' : 'Patient Dashboard')}</h1>
        </div>
      </div>

      <div className="call-topbar__right">
        {actionLabel ? (
          <button
            type="button"
            onClick={onAction}
            disabled={actionDisabled}
            className="call-topbar__action"
          >
            {actionLabel}
          </button>
        ) : null}
        <span className="call-topbar__badge">{isTherapist ? 'THERAPIST SESSION' : 'PATIENT SESSION'}</span>
      </div>
    </header>
  )
}
