import { useEffect, useState } from 'react'
import Navbar from './Navbar'
import Sidebar from './Sidebar'

export default function DashboardShell({ children, homePath = '/patient-home' }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    function handleResize() {
      if (window.innerWidth >= 1024) {
        setSidebarOpen(false)
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <div className="dashboard-shell">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} homePath={homePath} />
      <div className="dashboard-shell__content">
        <Navbar />
        <main className="dashboard-main">{children}</main>
      </div>
    </div>
  )
}
