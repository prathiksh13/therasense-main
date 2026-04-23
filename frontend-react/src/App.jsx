import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Chatbot from './components/Chatbot'
import LoadingScreen from './components/LoadingScreen'
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

function getLoadingContext(pathname) {
  if (pathname === '/login' || pathname === '/') return 'login'
  if (pathname.startsWith('/video-call') || pathname === '/patient' || pathname === '/therapist') return 'call'
  if (pathname.startsWith('/dashboard') || pathname.startsWith('/sessions') || pathname.startsWith('/reports')) return 'dashboard'
  return 'general'
}

export default function App() {
  const { theme } = useTheme()
  const { loading: authLoading } = useAuth()
  const location = useLocation()
  const [appState, setAppState] = useState('ready')
  const [displayLocation, setDisplayLocation] = useState(location)
  const [loadingContext, setLoadingContext] = useState(getLoadingContext(location.pathname))
  const transitionTimeoutRef = useRef(null)
  const activePathname = displayLocation.pathname
  const shouldShowLoading = authLoading || appState === 'loading'
  const hideChatbot = activePathname === '/' || activePathname === '/login' || shouldShowLoading
  const chatbotMode = activePathname.startsWith('/therapist') ? 'therapist' : 'patient'
  const routeFallback = useMemo(
    () => <div className="min-h-screen bg-transparent" aria-hidden="true" />,
    []
  )

  const transitionTo = useCallback((nextState, context = 'general', delayMs = 420) => {
    if (typeof nextState !== 'function') return

    if (transitionTimeoutRef.current) {
      window.clearTimeout(transitionTimeoutRef.current)
    }

    setLoadingContext(context)
    setAppState('loading')

    transitionTimeoutRef.current = window.setTimeout(() => {
      nextState()
      setAppState('ready')
    }, delayMs)
  }, [])

  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current) {
        window.clearTimeout(transitionTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (authLoading) {
      setLoadingContext(getLoadingContext(location.pathname))
      setAppState('loading')
      return
    }

    const skipGlobalLoader = Boolean(location.state?.skipGlobalLoader)

    if (location.key !== displayLocation.key) {
      if (skipGlobalLoader) {
        setLoadingContext(getLoadingContext(location.pathname))
        setDisplayLocation(location)
        setAppState('ready')
        return
      }

      transitionTo(() => setDisplayLocation(location), getLoadingContext(location.pathname), 420)
      return
    }

    setAppState('ready')
  }, [authLoading, displayLocation.key, location, transitionTo])

  return (
    <div className="app-shell" data-theme-current={theme}>
      {shouldShowLoading ? <LoadingScreen context={loadingContext} /> : null}
      {!shouldShowLoading ? (
      <Suspense fallback={routeFallback}>
        <Routes location={displayLocation}>
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
            element={
              <ProtectedRoute allowedRoles={['patient', 'therapist']}>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/sessions" element={<Sessions />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/resources" element={<Resources />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/assignments" element={<Assignments />} />
            <Route
              path="/journal"
              element={
                <ProtectedRoute allowedRoles={['patient']}>
                  <Journal />
                </ProtectedRoute>
              }
            />
            <Route
              path="/therapist/journal"
              element={
                <ProtectedRoute allowedRoles={['therapist']}>
                  <TherapistJournal />
                </ProtectedRoute>
              }
            />
          </Route>

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
