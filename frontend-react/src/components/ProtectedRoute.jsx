import { useEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getDashboardPath } from '../utils/auth'

export default function ProtectedRoute({ allowedRoles, children }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { loading, role, user } = useAuth()
  const redirectIssuedRef = useRef(false)
  const needsLoginRedirect = !loading && !user
  const roleMismatch = !loading && Boolean(user) && allowedRoles?.length && (!role || !allowedRoles.includes(role))
  const redirectTarget = needsLoginRedirect ? '/login' : roleMismatch ? getDashboardPath(role) : ''
  const redirectState = useMemo(() => {
    if (!needsLoginRedirect) return undefined
    return { from: location }
  }, [location, needsLoginRedirect])

  useEffect(() => {
    if (!redirectTarget || location.pathname === redirectTarget || redirectIssuedRef.current) return

    redirectIssuedRef.current = true

    navigate(redirectTarget, {
      replace: true,
      state: redirectState,
    })
  }, [location.pathname, navigate, redirectState, redirectTarget])

  if (loading) {
    return null
  }

  if (needsLoginRedirect || roleMismatch) {
    return null
  }

  return children
}
