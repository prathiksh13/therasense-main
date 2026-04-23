import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore'
import AppointmentForm from '../components/AppointmentForm'
import Dashboard from '../components/Dashboard'
import DashboardShell from '../components/DashboardShell'
import EmergencyButton from '../components/EmergencyButton'
import ChatWidget from '../components/ChatWidget'
import ReportList from '../components/ReportList'
import SessionList from '../components/SessionList'
import { firebaseAuth, firestoreDb } from '../lib/firebase'

function downloadTextFile(fileName, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function PatientHome() {
  const navigate = useNavigate()
  const [upcomingSessions, setUpcomingSessions] = useState([])
  const [pastReports, setPastReports] = useState([])
  const [therapistOptions, setTherapistOptions] = useState([])
  const [currentTherapist, setCurrentTherapist] = useState(null)
  const [patientProfile, setPatientProfile] = useState({ name: '', email: '', emergencyEmail: '' })
  const totalSessions = upcomingSessions.length + pastReports.length
  const lastMood = pastReports[0]?.subtitle?.split('|')?.[0]?.replace(/.*Session: /, '') || 'Neutral'
  const improvementScore = Math.min(100, 72 + pastReports.length * 4)

  const dashboardStats = [
    {
      icon: '📅',
      title: 'Total sessions',
      value: String(totalSessions),
      subtext: 'Booked and completed consultations',
    },
    {
      icon: '🙂',
      title: 'Last mood',
      value: lastMood,
      subtext: 'Latest observed emotional state',
    },
    {
      icon: '📈',
      title: 'Improvement score',
      value: `${improvementScore}%`,
      subtext: 'Trend based on recent reports',
    },
  ]

  const recentActivities = [
    ...(upcomingSessions.slice(0, 2).map((session) => ({
      title: 'Upcoming session booked',
      description: session.subtitle,
      time: session.title,
    }))),
    ...(pastReports.slice(0, 2).map((report) => ({
      title: 'Report generated',
      description: report.title,
      time: report.subtitle,
    }))),
  ]

  async function fetchReports(userId) {
    const reportsSnapshot = await getDocs(query(collection(firestoreDb, 'reports'), where('patientId', '==', userId)))
    return reportsSnapshot.docs.map((entry) => {
      const data = entry.data()
      const createdAt = data?.createdAt?.toDate ? data.createdAt.toDate() : null
      const createdLabel = createdAt ? createdAt.toLocaleString() : 'Timestamp unavailable'

      return {
        id: entry.id,
        title: `Session: ${data?.sessionId || entry.id}`,
        subtitle: `${data?.emotionSummary || 'No emotion summary'} | ${createdLabel}`,
        details: JSON.stringify(
          {
            sessionId: data?.sessionId || entry.id,
            emotionSummary: data?.emotionSummary || 'No emotion summary',
            timeline: data?.timeline || [],
            graphData: data?.graphData || {},
            createdAt: createdLabel,
          },
          null,
          2
        ),
      }
    })
  }

  useEffect(() => {
    const uid = firebaseAuth?.currentUser?.uid
    if (!uid) return

    async function loadPatientProfile() {
      const snapshot = await getDoc(doc(firestoreDb, 'users', uid))
      if (!snapshot.exists()) return

      const data = snapshot.data()
      setPatientProfile({
        name: data?.name || firebaseAuth.currentUser?.displayName || '',
        email: data?.email || firebaseAuth.currentUser?.email || '',
        emergencyEmail: data?.emergencyEmail || '',
      })
    }

    async function loadCurrentTherapist(therapistId) {
      if (!therapistId) {
        setCurrentTherapist(null)
        return
      }

      try {
        // Primary lookup from users collection where uid field matches therapistId.
        const therapistQuery = query(collection(firestoreDb, 'users'), where('uid', '==', therapistId), limit(1))
        const therapistSnapshot = await getDocs(therapistQuery)

        if (!therapistSnapshot.empty) {
          const therapistData = therapistSnapshot.docs[0].data()
          setCurrentTherapist({
            id: therapistId,
            name: therapistData?.name || 'Therapist',
            specialization: therapistData?.specialization || '',
            email: therapistData?.email || '',
          })
          return
        }

        const therapistDoc = await getDoc(doc(firestoreDb, 'users', therapistId))
        if (therapistDoc.exists()) {
          const therapistData = therapistDoc.data()
          setCurrentTherapist({
            id: therapistId,
            name: therapistData?.name || 'Therapist',
            specialization: therapistData?.specialization || '',
            email: therapistData?.email || '',
          })
          return
        }

        setCurrentTherapist(null)
      } catch (error) {
        console.error('Failed to load therapist details:', error)
        setCurrentTherapist(null)
      }
    }

    async function loadDashboardData() {
      try {
        await loadPatientProfile()
        const therapistSnapshot = await getDocs(query(collection(firestoreDb, 'users'), where('role', '==', 'therapist')))
        const therapists = therapistSnapshot.docs.map((entry) => {
          const data = entry.data()
          return {
            id: entry.id,
            name: data?.name || data?.email || 'Therapist',
            email: data?.email || '',
          }
        })
        setTherapistOptions(therapists)

        const sessionsSnapshot = await getDocs(query(collection(firestoreDb, 'sessions'), where('patientId', '==', uid)))
        const sessionDocs = sessionsSnapshot.docs.map((entry) => {
          const data = entry.data()
          const startTime = data?.startTime?.toDate ? data.startTime.toDate() : null
          const timeLabel = startTime ? `${startTime.toLocaleDateString()} at ${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Scheduled session'

          return {
            id: entry.id,
            title: timeLabel,
            subtitle: data?.therapistName || data?.therapistId || 'Assigned therapist',
            therapistId: data?.therapistId || '',
            startTime,
          }
        })

        sessionDocs.sort((a, b) => (b.startTime?.getTime?.() || 0) - (a.startTime?.getTime?.() || 0))
        setUpcomingSessions(sessionDocs)

        const latestSession = sessionDocs[0]
        await loadCurrentTherapist(latestSession?.therapistId)

        const fetchedReports = await fetchReports(uid)
        setPastReports(fetchedReports)
      } catch (error) {
        console.error('Failed to load patient dashboard:', error)
      }
    }

    loadDashboardData()
  }, [])

  async function handleBookAppointment(formData) {
    const patientId = firebaseAuth?.currentUser?.uid
    if (!patientId || !formData.therapistId) return

    try {
      const startTime = new Date(`${formData.date}T${formData.time}`)
      const docRef = await addDoc(collection(firestoreDb, 'sessions'), {
        patientId,
        therapistId: formData.therapistId,
        therapistName: formData.therapistName || '',
        startTime: Timestamp.fromDate(startTime),
      })

      const meetingLink = `${window.location.origin}/patient?sessionId=${docRef.id}`
      const title = `${startTime.toLocaleDateString()} at ${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      setUpcomingSessions((prev) => [
        {
          id: docRef.id,
          title,
          subtitle: formData.therapistName || formData.therapistId,
          therapistId: formData.therapistId,
          startTime,
        },
        ...prev,
      ])

      const selectedTherapist = therapistOptions.find((entry) => entry.id === formData.therapistId)
      setCurrentTherapist({
        id: formData.therapistId,
        name: selectedTherapist?.name || formData.therapistName || 'Therapist',
        specialization: '',
        email: '',
      })

      fetch('/send-booking-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: docRef.id,
          meetingLink,
        }),
      }).catch((error) => {
        console.error('Failed to send booking email:', error)
      })
    } catch (error) {
      console.error('Failed to book appointment:', error)
    }
  }

  function handleJoinSession(session) {
    if (session?.therapistId) {
      sessionStorage.setItem('activeTherapistId', session.therapistId)
    }
    if (session?.id) {
      sessionStorage.setItem('activeSessionId', session.id)
    }
    navigate('/patient')
  }

  async function handleDeleteSession(session) {
    if (!session?.id) return
    const shouldDelete = window.confirm('Are you sure?')
    if (!shouldDelete) return

    try {
      await deleteDoc(doc(firestoreDb, 'sessions', session.id))
      setUpcomingSessions((prev) => prev.filter((item) => item.id !== session.id))
    } catch (error) {
      console.error('Failed to delete session:', error)
    }
  }

  function handleViewReport(report) {
    downloadTextFile(`${report.id}.txt`, `${report.title}\n${report.subtitle}\n\n${report.details}`)
  }

  async function handleDeleteReport(report) {
    if (!report?.id) return
    const shouldDelete = window.confirm('Are you sure?')
    if (!shouldDelete) return

    try {
      await deleteDoc(doc(firestoreDb, 'reports', report.id))
      setPastReports((prev) => prev.filter((item) => item.id !== report.id))
    } catch (error) {
      console.error('Failed to delete report:', error)
    }
  }

  return (
    <DashboardShell homePath="/patient-home">
      <section className="dashboard-stack">
        <Dashboard
          upcomingSession={upcomingSessions[0] ? {
            title: upcomingSessions[0].subtitle || 'Therapy session',
            subtitle: currentTherapist ? currentTherapist.name : 'Assigned therapist',
            date: upcomingSessions[0].title,
            time: currentTherapist?.email || 'Join from your dashboard',
          } : null}
          stats={dashboardStats}
          activities={recentActivities}
        />

        <div className="dashboard-grid--cards" id="sessions">
          <AppointmentForm therapists={therapistOptions} onBook={handleBookAppointment} />

          <section className="glass p-4">
            <h2 className="text-lg font-semibold text-slate-100">Current Therapist</h2>
            {currentTherapist ? (
              <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-slate-200">
                <p className="font-semibold text-slate-100">{currentTherapist.name}</p>
                <p className="mt-1 text-xs text-slate-400">{currentTherapist.email || 'No email available'}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {currentTherapist.specialization ? `Specialization: ${currentTherapist.specialization}` : 'Specialization not provided'}
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">No therapist assigned for your current session yet.</p>
            )}
          </section>

          <EmergencyButton
            patientId={firebaseAuth?.currentUser?.uid}
            patientName={patientProfile.name}
            emergencyEmail={patientProfile.emergencyEmail}
          />

          <SessionList
            title="Upcoming Sessions"
            sessions={upcomingSessions}
            actionLabel="Join"
            onAction={handleJoinSession}
            onDelete={handleDeleteSession}
            hideSubtitle
            emptyText="No upcoming sessions"
          />

          <ReportList
            title="Past Sessions"
            reports={pastReports}
            actionLabel="Download report"
            onAction={handleViewReport}
            onDelete={handleDeleteReport}
          />
        </div>

        <div id="reports" />
      </section>
      <ChatWidget mode="patient" />
    </DashboardShell>
  )
}
