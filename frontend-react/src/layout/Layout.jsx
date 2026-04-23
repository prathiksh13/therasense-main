import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import Navbar from './Navbar'
import Sidebar from './Sidebar'

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(window.localStorage.getItem('therasense-sidebar-width') || 0)
    return Number.isFinite(stored) && stored >= 240 && stored <= 260 ? stored : 248
  })
  const location = useLocation()

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

    window.addEventListener('therasense-sidebar-resize-start', handleResizeStart)
    return () => window.removeEventListener('therasense-sidebar-resize-start', handleResizeStart)
  }, [sidebarWidth])

  useEffect(() => {
    window.localStorage.setItem('therasense-sidebar-width', String(Math.round(sidebarWidth)))
  }, [sidebarWidth])

  return (
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
          <div key={location.pathname} className="page-transition">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
