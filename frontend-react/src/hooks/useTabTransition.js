import { useCallback, useEffect, useRef, useState } from 'react'

export default function useTabTransition(durationMs = 300) {
  const [isTransitioning, setIsTransitioning] = useState(false)
  const timeoutRef = useRef(null)

  const transitionTab = useCallback(
    (updateTab) => {
      if (typeof updateTab !== 'function') return
      setIsTransitioning(true)
      updateTab()

      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current)
      }

      timeoutRef.current = window.setTimeout(() => {
        setIsTransitioning(false)
      }, durationMs)
    },
    [durationMs]
  )

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return { isTransitioning, transitionTab }
}