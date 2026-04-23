import { lazy, Suspense, useMemo } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Chatbot from './components/Chatbot'
import PublicRoute from './components/PublicRoute'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './layout/Layout'
import { useAuth } from './context/AuthContext'
import { useTheme } from './context/ThemeContext'

const LandingPage = lazy(() => import('./pages/LandingPage'))
const Login = lazy(() => import('./pages/Login'))
const Patient = lazy(() => import('./pages/Patient'))
const Therapist = lazy(() => import('./pages/Therapist'))
const VideoCall = lazy(() => import('./pages/VideoCall'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Sessions = lazy(() => import('./pages/Sessions'))
const Reports = lazy(() => import('./pages/Reports'))
const Profile = lazy(() => import('./pages/Profile'))
const Journal = lazy(() => import('./pages/Journal'))
const Resources = lazy(() => import('./pages/Resources'))
const TherapistJournal = lazy(() => import('./pages/TherapistJournal'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const Assignments = lazy(() => import('./pages/Assignments'))

export default function App() {
  const { theme } = useTheme()
  const { loading: authLoading } = useAuth()
  const location = useLocation()
  const hideChatbot = location.pathname === '/' || location.pathname === '/login'
  const chatbotMode = location.pathname.startsWith('/therapist') ? 'therapist' : 'patient'
  const routeFallback = useMemo(
    () => <div className="min-h-screen bg-transparent" aria-hidden="true" />,
    []
  )

  return (
    <div className="app-shell" data-theme-current={theme}>
      {authLoading ? routeFallback : null}
      {!authLoading ? (
      <Suspense fallback={routeFallback}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route
            path="/login"
            element={
              <PublicRoute>
                <Login />
              </PublicRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute allowedRoles={['patient', 'therapist']}>
                <Layout>
                  <Dashboard />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/sessions"
            element={
              <ProtectedRoute allowedRoles={['patient', 'therapist']}>
                <Layout>
                  <Sessions />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/patient"
            element={
              <ProtectedRoute allowedRoles={['patient']}>
                <Patient />
              </ProtectedRoute>
            }
          />
          <Route
            path="/therapist"
            element={
              <ProtectedRoute allowedRoles={['therapist']}>
                <Therapist />
              </ProtectedRoute>
            }
          />
          <Route
            path="/video-call/:roomId"
            element={
              <ProtectedRoute allowedRoles={['patient', 'therapist']}>
                <VideoCall />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports"
            element={
              <ProtectedRoute allowedRoles={['patient', 'therapist']}>
                <Layout>
                  <Reports />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute allowedRoles={['patient', 'therapist']}>
                <Layout>
                  <Profile />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/resources"
            element={
              <ProtectedRoute allowedRoles={['patient', 'therapist']}>
                <Layout>
                  <Resources />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/journal"
            element={
              <ProtectedRoute allowedRoles={['patient']}>
                <Layout>
                  <Journal />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute allowedRoles={['patient', 'therapist']}>
                <Layout>
                  <SettingsPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/assignments"
            element={
              <ProtectedRoute allowedRoles={['patient', 'therapist']}>
                <Layout>
                  <Assignments />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/therapist/journal"
            element={
              <ProtectedRoute allowedRoles={['therapist']}>
                <Layout>
                  <TherapistJournal />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route path="/patient-home" element={<Navigate to="/dashboard" replace />} />
          <Route path="/therapist-home" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      ) : null}
      {!hideChatbot ? <Chatbot mode={chatbotMode} /> : null}
    </div>
  )
}
