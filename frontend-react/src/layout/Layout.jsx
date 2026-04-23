import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { PageTransitionContext } from '../context/PageTransitionContext'
import { NAV_EXIT_DURATION_MS, pageCardContainerVariants, pageShellVariants } from '../lib/pageTransitionMotion'
import LoadingScreen from '../components/LoadingScreen'
import Navbar from './Navbar'
import Sidebar from './Sidebar'
import { TabLoadingContext } from '../context/TabLoadingContext'

export default function Layout() {
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [isLeaving, setIsLeaving] = useState(false)
  const [tabLoading, setTabLoading] = useState(false)
  const transitionLoadingRef = useRef(false)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(window.localStorage.getItem('serien-sidebar-width') || 0)
    return Number.isFinite(stored) && stored >= 240 && stored <= 260 ? stored : 248
  })
  const location = useLocation()
  const transitionTimeoutRef = useRef(null)

  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname])

  useEffect(() => {
    function handleResize() {
      if (window.innerWidth >= 1024) {
        setSidebarOpen(false)
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    function handleResizeStart(event) {
      if (window.innerWidth < 1024) return

      const startX = event?.detail?.clientX || 0
      const startWidth = sidebarWidth

      function onMouseMove(moveEvent) {
        const next = Math.min(260, Math.max(240, startWidth + (moveEvent.clientX - startX)))
        setSidebarWidth(next)
      }

      function onMouseUp() {
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
      }

      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('serien-sidebar-resize-start', handleResizeStart)
    return () => window.removeEventListener('serien-sidebar-resize-start', handleResizeStart)
  }, [sidebarWidth])

  useEffect(() => {
    window.localStorage.setItem('serien-sidebar-width', String(Math.round(sidebarWidth)))
  }, [sidebarWidth])

  useEffect(() => {
    setIsLeaving(false)

    if (!transitionLoadingRef.current) return

    const timer = window.setTimeout(() => {
      transitionLoadingRef.current = false
      setTabLoading(false)
    }, 300)

    return () => window.clearTimeout(timer)
  }, [location.key])

  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current) {
        window.clearTimeout(transitionTimeoutRef.current)
      }
    }
  }, [])

  const navigateWithTransition = useCallback((to, options = {}) => {
    if (!to) return

    const currentTarget = `${location.pathname}${location.search || ''}${location.hash || ''}`
    if (to === currentTarget || to === location.pathname) return

    if (transitionTimeoutRef.current) {
      window.clearTimeout(transitionTimeoutRef.current)
    }

    transitionLoadingRef.current = true
    setTabLoading(true)
    setIsLeaving(true)

    transitionTimeoutRef.current = window.setTimeout(() => {
      navigate(to, {
        ...options,
        state: {
          ...(options.state || {}),
        },
      })
    }, NAV_EXIT_DURATION_MS)
  }, [location.hash, location.pathname, location.search, navigate])

  const transitionValue = useMemo(() => ({
    isLeaving,
    navigateWithTransition,
  }), [isLeaving, navigateWithTransition])

  const tabLoadingValue = useMemo(() => ({
    tabLoading,
    setTabLoading,
  }), [tabLoading])

  return (
    <PageTransitionContext.Provider value={transitionValue}>
      <TabLoadingContext.Provider value={tabLoadingValue}>
        <div
          className={`workspace-layout dashboard-shell ${collapsed ? 'is-collapsed' : ''}`}
          style={{ '--sidebar-width': `${sidebarWidth}px` }}
        >
          <Sidebar
            open={sidebarOpen}
            collapsed={collapsed}
            onClose={() => setSidebarOpen(false)}
            onToggleCollapse={() => setCollapsed((prev) => !prev)}
          />
          <div className="workspace-layout__content dashboard-shell__content ts-main-content">
            <Navbar />
            <main className="dashboard-main">
              {tabLoading && <LoadingScreen context="general" variant="tab-overlay" />}
              <AnimatePresence mode="wait">
                <motion.div
                  key={location.pathname}
                  className="page-transition"
                  variants={pageShellVariants}
                  initial="initial"
                  animate="enter"
                  exit="exit"
                >
                  <motion.div
                    className="ts-page-transition-cards"
                    variants={pageCardContainerVariants}
                    initial="initial"
                    animate={isLeaving ? 'exit' : 'enter'}
                  >
                    <Suspense fallback={<LoadingScreen context="general" variant="tab-overlay" />}>
                      <Outlet />
                    </Suspense>
                  </motion.div>
                </motion.div>
              </AnimatePresence>
            </main>
          </div>
        </div>
      </TabLoadingContext.Provider>
    </PageTransitionContext.Provider>
  )
}

