import Badge from './ui/Badge'
import { GreenButton, OutlineButton } from './ui/Buttons'
import { motion } from 'framer-motion'
import { usePageTransition } from '../context/PageTransitionContext'
import { cardBackgroundVariants, cardMotionVariants } from '../lib/pageTransitionMotion'

export function normalizeSessionStatus(status = '') {
  const value = String(status || '').toLowerCase()
  if (value === 'accepted') return 'confirmed'
  if (value === 'ongoing' || value === 'live') return 'active'
  if (value === 'done') return 'completed'
  if (value === 'canceled') return 'cancelled'
  if (value === 'pending' || value === 'confirmed' || value === 'active' || value === 'completed' || value === 'cancelled') {
    return value
  }
  return 'pending'
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="7" width="13" height="10" rx="2" />
      <path d="m16 10 5-3v10l-5-3" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l2.5 2" />
    </svg>
  )
}

function statusLabel(status) {
  if (status === 'active') return 'Live'
  if (status === 'completed') return 'Completed'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

export default function SessionCard({
  session,
  currentUserRole,
  currentUserId,
  onAccept,
  onStart,
  onJoin,
  onEnd,
  readOnly = false,
  embedded = false,
  hidePersonLine = false,
}) {
  const transition = usePageTransition()
  const status = normalizeSessionStatus(session?.status)
  const isTherapist = currentUserRole === 'therapist'
  const isPatient = currentUserRole === 'patient'
  const belongsToPatient = isPatient && (!session?.patientId || session.patientId === currentUserId)

  const showAccept = !readOnly && isTherapist && status === 'pending'
  const showStart = !readOnly && isTherapist && status === 'confirmed'
  const showEnd = !readOnly && isTherapist && status === 'active'
  const showPatientJoin = !readOnly && isPatient && status === 'active' && belongsToPatient
  const showTherapistJoin = !readOnly && isTherapist && status === 'active'

  const cardClassName = `ts-card ${embedded ? 'ts-card--embedded' : ''}`.trim()

  if (!transition) {
    return (
      <article className={cardClassName}>
        <div className="ts-row-between">
          <div className="ts-stack-sm">
            {!hidePersonLine ? (
              <p className="ts-session-line">{isTherapist ? (session?.patientName || session?.patientId || 'Patient') : (session?.therapistName || session?.therapistId || 'Therapist')}</p>
            ) : null}
            <p className="ts-session-line">{session?.dateLabel || session?.date || 'Date unavailable'}</p>
            <p className="ts-session-line">{session?.timeLabel || session?.time || 'Time unavailable'}</p>
          </div>
          <div className="ts-stack-sm ts-align-end">
            <Badge status={status}>{statusLabel(status)}</Badge>
            <div className="ts-session-actions">
              {showPatientJoin || showTherapistJoin ? (
                <GreenButton onClick={() => onJoin?.(session)}>
                  <CameraIcon />
                  Join Call
                </GreenButton>
              ) : null}

              {showAccept ? (
                <OutlineButton className="ts-btn--green-outline" onClick={() => onAccept?.(session)}>
                  Accept Session
                </OutlineButton>
              ) : null}

              {showStart ? (
                <GreenButton onClick={() => onStart?.(session)}>
                  <CameraIcon />
                  Start Session
                </GreenButton>
              ) : null}

              {showEnd ? (
                <OutlineButton className="ts-btn--danger-outline" onClick={() => onEnd?.(session)}>
                  End Session
                </OutlineButton>
              ) : null}
            </div>

            {!readOnly && isPatient && status === 'pending' ? (
              <p className="ts-session-note ts-session-note--pending">Awaiting confirmation</p>
            ) : null}

            {!readOnly && isPatient && status === 'confirmed' ? (
              <p className="ts-session-note ts-session-note--waiting">
                <ClockIcon />
                Waiting for therapist to start...
              </p>
            ) : null}
          </div>
        </div>
      </article>
    )
  }

  return (
    <motion.article className={cardClassName} variants={cardMotionVariants}>
      <motion.span className="ts-card-transition-bg" aria-hidden="true" variants={cardBackgroundVariants} />
      <div className="ts-card-transition-content">
      <div className="ts-row-between">
        <div className="ts-stack-sm">
          {!hidePersonLine ? (
            <p className="ts-session-line">{isTherapist ? (session?.patientName || session?.patientId || 'Patient') : (session?.therapistName || session?.therapistId || 'Therapist')}</p>
          ) : null}
          <p className="ts-session-line">{session?.dateLabel || session?.date || 'Date unavailable'}</p>
          <p className="ts-session-line">{session?.timeLabel || session?.time || 'Time unavailable'}</p>
        </div>
        <div className="ts-stack-sm ts-align-end">
          <Badge status={status}>{statusLabel(status)}</Badge>
          <div className="ts-session-actions">
            {showPatientJoin || showTherapistJoin ? (
              <GreenButton onClick={() => onJoin?.(session)}>
                <CameraIcon />
                Join Call
              </GreenButton>
            ) : null}

            {showAccept ? (
              <OutlineButton className="ts-btn--green-outline" onClick={() => onAccept?.(session)}>
                Accept Session
              </OutlineButton>
            ) : null}

            {showStart ? (
              <GreenButton onClick={() => onStart?.(session)}>
                <CameraIcon />
                Start Session
              </GreenButton>
            ) : null}

            {showEnd ? (
              <OutlineButton className="ts-btn--danger-outline" onClick={() => onEnd?.(session)}>
                End Session
              </OutlineButton>
            ) : null}
          </div>

          {!readOnly && isPatient && status === 'pending' ? (
            <p className="ts-session-note ts-session-note--pending">Awaiting confirmation</p>
          ) : null}

          {!readOnly && isPatient && status === 'confirmed' ? (
            <p className="ts-session-note ts-session-note--waiting">
              <ClockIcon />
              Waiting for therapist to start...
            </p>
          ) : null}
        </div>
      </div>
      </div>
    </motion.article>
  )
}
