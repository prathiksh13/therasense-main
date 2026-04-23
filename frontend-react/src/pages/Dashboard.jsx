import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Card from '../components/ui/Card'
import SessionCard, { normalizeSessionStatus } from '../components/SessionCard'
import usePatientWorkspaceData from '../hooks/usePatientWorkspaceData'
import useTherapistWorkspaceData from '../hooks/useTherapistWorkspaceData'
import useUserRole from '../hooks/useUserRole'
import { handleJoinCall } from '../utils/sessionCall'

export default function Dashboard() {
  const navigate = useNavigate()
  const { role } = useUserRole()
  const patientData = usePatientWorkspaceData()
  const therapistData = useTherapistWorkspaceData()
  const isTherapist = role === 'therapist'

  const profileName = useMemo(() => {
    if (isTherapist) return therapistData.patients?.[0]?.label?.replace('Patient: ', '') || 'Therapist'
    return patientData.patientProfile?.name || 'Sarah'
  }, [isTherapist, patientData.patientProfile?.name, therapistData.patients])

  const nextSession = useMemo(() => {
    const sourceList = isTherapist ? therapistData.sessions : patientData.upcomingSessions
    const candidateList = sourceList.filter((item) => {
      const status = normalizeSessionStatus(item.status)
      return status === 'active' || status === 'pending' || status === 'confirmed'
    })

    const source =
      candidateList.find((item) => normalizeSessionStatus(item.status) === 'active') ||
      candidateList[0]

    if (!source) return null

    const date = source.scheduledAt || source.startTime
    const dateLabel = date?.toDate ? date.toDate().toLocaleDateString() : source?.scheduledAt?.toLocaleDateString?.() || 'TBD'
    const timeLabel = date?.toDate
      ? date.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : source?.scheduledAt?.toLocaleTimeString?.([], { hour: '2-digit', minute: '2-digit' }) || 'TBD'

    return {
      id: source.id,
      roomId: source.roomId || source.id,
      patientId: source.patientId,
      patientName: source.patientName,
      therapistId: source.therapistId,
      therapistName: source.therapistName,
      status: normalizeSessionStatus(source.status),
      dateLabel,
      timeLabel,
    }
  }, [isTherapist, patientData.upcomingSessions, therapistData.sessions])

  const todaysSessionCount = useMemo(() => {
    if (!isTherapist) return 0
    const today = new Date()
    const y = today.getFullYear()
    const m = today.getMonth()
    const d = today.getDate()

    return therapistData.sessions.filter((session) => {
      const value = session?.scheduledAt || session?.startTime
      const date = value?.toDate ? value.toDate() : value instanceof Date ? value : null
      if (!date) return false
      return date.getFullYear() === y && date.getMonth() === m && date.getDate() === d
    }).length
  }, [isTherapist, therapistData.sessions])

  const therapistStats = useMemo(() => {
    if (!isTherapist) return null
    const total = therapistData.sessions.length
    const completed = therapistData.sessions.filter((session) => normalizeSessionStatus(session.status) === 'completed').length
    const completionRate = total ? `${Math.round((completed / total) * 100)}%` : '0%'
    return {
      patients: therapistData.metrics.totalPatients || 0,
      sessions: therapistData.metrics.totalSessions || 0,
      completionRate,
    }
  }, [isTherapist, therapistData.metrics.totalPatients, therapistData.metrics.totalSessions, therapistData.sessions])

  const activeSession = useMemo(() => {
    if (!isTherapist) return null
    return therapistData.sessions.find((session) => normalizeSessionStatus(session.status) === 'active') || null
  }, [isTherapist, therapistData.sessions])

  const therapistUpcoming = useMemo(() => {
    if (!isTherapist) return []
    return therapistData.sessions
      .filter((session) => {
        const status = normalizeSessionStatus(session.status)
        return status === 'pending' || status === 'confirmed' || status === 'active'
      })
      .slice(0, 6)
  }, [isTherapist, therapistData.sessions])

  function formatSessionTime(session) {
    const value = session?.scheduledAt || session?.startTime
    const date = value?.toDate ? value.toDate() : value instanceof Date ? value : null
    if (!date) return { time: 'TBD', day: 'No date' }
    return {
      time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      day: date.toLocaleDateString(),
    }
  }

  function getReportTitleLabel(title = '') {
    const raw = String(title).replace(/^Session:\s*/i, '').trim()
    if (!raw) return 'Session Report'
    const shortId = raw.length > 10 ? raw.slice(-10) : raw
    return `Session Report • ${shortId}`
  }

  function getReportSummary(subtitle = '') {
    const text = String(subtitle || '').trim()
    if (!text) return 'No summary available.'
    return text.length > 110 ? `${text.slice(0, 110)}...` : text
  }

  async function handleJoinSession(session) {
    const targetSession = session || nextSession
    if (!targetSession?.id) return
    await handleJoinCall({
      sessionId: targetSession.id,
      role,
      currentUserId: patientData.uid,
      navigate,
    })
  }

  async function handleAcceptSession(session) {
    if (!isTherapist || !session?.id || !therapistData.acceptSession) return
    await therapistData.acceptSession(session.id)
  }

  async function handleStartSession(session) {
    if (!isTherapist || !session?.id || !therapistData.startSession) return
    await therapistData.startSession(session.id)
    await handleJoinCall({
      sessionId: session.id,
      role,
      currentUserId: patientData.uid,
      navigate,
    })
  }

  async function handleEndSession(session) {
    if (!isTherapist || !session?.id || !therapistData.endSession) return
    await therapistData.endSession(session.id)
  }

  if (isTherapist) {
    return (
      <section className="ts-page therapist-overview">
        <header className="therapist-overview__head">
          <h1 className="ts-page-title">Practice Overview</h1>
          <p className="ts-page-subtitle">Review reports, sessions, and patient queue at a glance.</p>
        </header>

        <section className="therapist-overview__top-grid">
          <Card className="therapist-overview__stats-card">
            <div className="therapist-overview__stats-grid">
              <div className="therapist-overview__stat-tile">
                <p>Patients</p>
                <strong>{therapistStats?.patients ?? 0}</strong>
              </div>
              <div className="therapist-overview__stat-tile">
                <p>Sessions</p>
                <strong>{therapistStats?.sessions ?? 0}</strong>
              </div>
              <div className="therapist-overview__stat-tile">
                <p>Completion</p>
                <strong>{therapistStats?.completionRate ?? '0%'}</strong>
              </div>
            </div>
          </Card>

          <Card className="therapist-overview__profile-card">
            <div className="therapist-overview__avatar">{String(profileName || 'T').slice(0, 1).toUpperCase()}</div>
            <h2>{profileName}</h2>
            <p>Licensed Therapist</p>
            <button type="button" className="ts-btn ts-btn--primary" onClick={() => navigate('/therapist')}>
              Join Video Call
            </button>
          </Card>
        </section>

        <section className="therapist-overview__mid-grid">
          <Card className="therapist-overview__panel">
            <div className="therapist-overview__panel-head">
              <h2>Recent Patient Reports</h2>
              <button type="button" className="ts-link" onClick={() => navigate('/reports')}>View all</button>
            </div>
            {therapistData.reports.length ? (
              <ul className="therapist-overview__list">
                {therapistData.reports.slice(0, 2).map((report) => (
                  <li key={report.id} className="therapist-overview__list-item">
                    <div>
                      <p className="therapist-overview__list-title">{getReportTitleLabel(report.title)}</p>
                      <p className="therapist-overview__list-sub">{getReportSummary(report.subtitle)}</p>
                    </div>
                    <span className="therapist-overview__pill">Report</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ts-text-secondary">No reports available yet.</p>
            )}
          </Card>

          <Card className="therapist-overview__panel">
            <div className="therapist-overview__panel-head">
              <h2>Ongoing Sessions</h2>
              <span className="therapist-overview__meta">Today: {todaysSessionCount}</span>
            </div>
            {activeSession ? (
              <div className="therapist-overview__ongoing">
                <p className="therapist-overview__list-title">{activeSession.title}</p>
                <p className="therapist-overview__list-sub">{activeSession.subtitle}</p>
                <div className="therapist-overview__actions">
                  <button type="button" className="ts-btn ts-btn--primary" onClick={() => handleJoinSession(activeSession)}>Join</button>
                  <button type="button" className="ts-btn ts-btn--outline" onClick={() => handleEndSession(activeSession)}>End</button>
                </div>
              </div>
            ) : (
              <p className="ts-text-secondary">No active sessions right now.</p>
            )}
          </Card>
        </section>

        <Card className="therapist-overview__queue-card">
          <div className="therapist-overview__panel-head">
            <h2>Up Next</h2>
            <p className="therapist-overview__meta">Manage upcoming appointments and start when ready.</p>
          </div>

          {therapistUpcoming.length ? (
            <div className="therapist-overview__queue-list">
              {therapistUpcoming.map((session) => {
                const status = normalizeSessionStatus(session.status)
                const slot = formatSessionTime(session)
                return (
                  <div key={session.id} className="therapist-overview__queue-item">
                    <div className="therapist-overview__queue-time">
                      <strong>{slot.time}</strong>
                      <span>{slot.day}</span>
                    </div>
                    <div className="therapist-overview__queue-main">
                      <p>{session.patientName || session.title}</p>
                      <span>{session.subtitle}</span>
                      <em className={`therapist-overview__status-chip therapist-overview__status-chip--${status}`}>{status}</em>
                    </div>
                    <div className="therapist-overview__queue-action">
                      {status === 'pending' ? (
                        <button type="button" className="ts-btn ts-btn--outline" onClick={() => handleAcceptSession(session)}>Accept</button>
                      ) : null}
                      {status === 'confirmed' ? (
                        <button type="button" className="ts-btn ts-btn--primary" onClick={() => handleStartSession(session)}>Start Session</button>
                      ) : null}
                      {status === 'active' ? (
                        <button type="button" className="ts-btn ts-btn--primary" onClick={() => handleJoinSession(session)}>Join</button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="ts-text-secondary">No upcoming sessions in queue.</p>
          )}
        </Card>
      </section>
    )
  }

  return (
    <section className="ts-page">
      <header>
        <h1 className="ts-page-title">Good morning, {profileName}</h1>
        <p className="ts-page-subtitle">Here&apos;s what&apos;s happening with your care today.</p>
      </header>

      <section className="ts-dashboard-grid">
        <div className="ts-stack">
          <Card>
            <div className="ts-card-header">
              <h2 className="ts-section-title">Your Next Session</h2>
              <div className="ts-row-actions">
                <button type="button" className="ts-link" onClick={() => navigate('/sessions')}>View All</button>
              </div>
            </div>

            {nextSession ? (
              <SessionCard
                embedded
                session={nextSession}
                currentUserRole={role}
                currentUserId={patientData.uid}
                hidePersonLine={!isTherapist}
                onAccept={handleAcceptSession}
                onStart={handleStartSession}
                onJoin={handleJoinSession}
                onEnd={handleEndSession}
              />
            ) : (
              <p className="ts-text-secondary">No upcoming session found.</p>
            )}
          </Card>

          <section>
            <h2 className="ts-section-title" style={{ marginBottom: '12px' }}>Quick Resources</h2>
            <div className="ts-resource-grid">
              <Card className="ts-resource-mini" onClick={() => navigate('/resources?category=breathing')}>
                <div className="ts-resource-mini__icon">R1</div>
                <p className="ts-resource-mini__title">Breathing</p>
              </Card>
              <Card className="ts-resource-mini" onClick={() => navigate('/resources?tab=faq&category=faq')}>
                <div className="ts-resource-mini__icon">R2</div>
                <p className="ts-resource-mini__title">Guides</p>
              </Card>
              <Card className="ts-resource-mini" onClick={() => navigate('/resources?category=grounding')}>
                <div className="ts-resource-mini__icon">R3</div>
                <p className="ts-resource-mini__title">Daily Tips</p>
              </Card>
            </div>
          </section>
        </div>
      </section>
    </section>
  )
}
