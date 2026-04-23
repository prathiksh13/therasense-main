import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppointmentForm from '../components/AppointmentForm'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import SessionCard, { normalizeSessionStatus } from '../components/SessionCard'
import SearchBar from '../components/ui/SearchBar'
import SectionHeader from '../components/ui/SectionHeader'
import { useAuth } from '../context/AuthContext'
import { useTabLoading } from '../context/TabLoadingContext'
import usePatientWorkspaceData from '../hooks/usePatientWorkspaceData'
import useTherapistWorkspaceData from '../hooks/useTherapistWorkspaceData'
import { handleJoinCall } from '../utils/sessionCall'

function parseSessionDate(session) {
  const value = session?.scheduledAt || session?.startTime || null
  const date = value?.toDate ? value.toDate() : value instanceof Date ? value : null
  if (!date) return { dateLabel: 'Date unavailable', timeLabel: 'Time unavailable', timeValue: 0 }

  return {
    dateLabel: date.toLocaleDateString(),
    timeLabel: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    timeValue: date.getTime(),
  }
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="5" width="16" height="15" rx="3" />
      <path d="M8 3v4M16 3v4M4 10h16" />
    </svg>
  )
}

export default function Sessions() {
  const navigate = useNavigate()
  const { role, loading: authLoading } = useAuth()
  const isTherapist = role === 'therapist'
  const patientData = usePatientWorkspaceData()
  const therapistData = useTherapistWorkspaceData()
  const { setTabLoading } = useTabLoading()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showBooking, setShowBooking] = useState(false)

  const activeData = isTherapist ? therapistData : patientData
  const loading = authLoading || activeData.loading

  // Trigger data refresh when status filter changes
  useEffect(() => {
    if (statusFilter !== 'all') {
      setTabLoading(true)
      if (activeData.refresh) {
        activeData.refresh().finally(() => setTabLoading(false))
      }
    }
  }, [statusFilter, activeData])

  const sessions = useMemo(() => {
    if (isTherapist) return therapistData.sessions
    return patientData.upcomingSessions
  }, [isTherapist, patientData.upcomingSessions, therapistData.sessions])

  const normalized = useMemo(() => {
    return sessions.map((session) => {
      const schedule = parseSessionDate(session)
      return {
        ...session,
        status: session.status || 'pending',
        personLabel: isTherapist
          ? session.patientName || session.patientId || 'Patient'
          : session.therapistName || session.therapistId || 'Therapist',
        ...schedule,
      }
    })
  }, [isTherapist, sessions])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return normalized.filter((session) => {
      const status = normalizeSessionStatus(session.status)
      const statusMatches = statusFilter === 'all' || status === statusFilter
      const textMatches = !needle || String(session.personLabel).toLowerCase().includes(needle)
      return statusMatches && textMatches
    })
  }, [normalized, search, statusFilter])

  const upcoming = useMemo(() => {
    const now = Date.now()
    return filtered.filter((session) => {
      if (!session.timeValue) return true
      const status = normalizeSessionStatus(session.status)
      return session.timeValue >= now && status !== 'completed' && status !== 'cancelled'
    })
  }, [filtered])

  const past = useMemo(() => {
    const now = Date.now()
    return filtered.filter((session) => {
      if (!session.timeValue) return false
      const status = normalizeSessionStatus(session.status)
      return session.timeValue < now || status === 'completed' || status === 'cancelled'
    })
  }, [filtered])

  async function handleBookAppointment(formData) {
    if (!patientData.bookAppointment) return
    await patientData.bookAppointment(formData)
    setShowBooking(false)
  }

  async function handleAccept(sessionId) {
    if (!sessionId || !therapistData.acceptSession) return
    await therapistData.acceptSession(sessionId)
  }

  async function handleStart(sessionId) {
    if (!sessionId || !therapistData.startSession) return
    await therapistData.startSession(sessionId)
    await handleJoinCall({
      sessionId,
      role,
      currentUserId: patientData.uid,
      navigate,
    })
  }

  async function handleEnd(sessionId) {
    if (!sessionId || !therapistData.endSession) return
    await therapistData.endSession(sessionId)
  }

  async function handleJoin(session) {
    if (!session?.id) return
    await handleJoinCall({
      sessionId: session.id,
      role,
      currentUserId: patientData.uid,
      navigate,
    })
  }

  return (
    <section className="ts-page">
      <SectionHeader
        title="Appointments"
        subtitle="Schedule and manage your sessions"
        actionLabel={isTherapist ? '' : (showBooking ? 'Close Booking' : 'New Appointment')}
        onAction={() => setShowBooking((prev) => !prev)}
      />

      {showBooking && !isTherapist ? (
        <Card className="ts-card--booking">
          <AppointmentForm therapists={patientData.therapistOptions} onBook={handleBookAppointment} />
        </Card>
      ) : null}

      <div className="ts-toolbar">
        <SearchBar
          placeholder="Search therapist..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          icon={<CalendarIcon />}
        />
        <select className="ts-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">All Status</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="active">Live</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {!loading ? (
        <>
          <section className="ts-stack">
            <h2 className="ts-section-title">Upcoming Sessions</h2>
            {upcoming.length ? (
              upcoming.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  currentUserRole={role}
                  currentUserId={patientData.uid}
                  onAccept={(item) => handleAccept(item.id)}
                  onStart={(item) => handleStart(item.id)}
                  onJoin={handleJoin}
                  onEnd={(item) => handleEnd(item.id)}
                />
              ))
            ) : (
              <EmptyState
                icon={<CalendarIcon />}
                title="No upcoming sessions"
                description={isTherapist ? 'Your scheduled sessions will appear here' : 'Schedule your first session to get started'}
                actionLabel={isTherapist ? '' : 'Book Now'}
                onAction={isTherapist ? undefined : () => setShowBooking(true)}
              />
            )}
          </section>

          <section className="ts-stack">
            <h2 className="ts-section-title">Past Sessions</h2>
            {past.length ? (
              past.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  currentUserRole={role}
                  currentUserId={patientData.uid}
                  readOnly={isTherapist}
                  onJoin={handleJoin}
                />
              ))
            ) : (
              <Card>
                <p className="ts-text-secondary">No past sessions found.</p>
              </Card>
            )}
          </section>
        </>
      ) : (
        <Card>
          <p className="ts-text-secondary">Loading sessions...</p>
        </Card>
      )}
    </section>
  )
}
