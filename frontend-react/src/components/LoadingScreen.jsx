import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'

const MESSAGE_SETS = {
  login: [
    'Securing your session...',
    'Preparing your personalized sign-in...',
    'Almost there. Getting things ready...',
  ],
  dashboard: [
    'Syncing your dashboard insights...',
    'Loading your latest sessions...',
    'Arranging your care workspace...',
  ],
  call: [
    'Preparing your call environment...',
    'Warming up real-time channels...',
    'Setting up a smooth connection...',
  ],
  general: [
    'Loading your next view...',
    'Optimizing your experience...',
    'One moment while we transition...',
  ],
}

export default function LoadingScreen({ context = 'general', variant = 'full' }) {
  const [messageIndex, setMessageIndex] = useState(0)

  const messages = useMemo(() => MESSAGE_SETS[context] || MESSAGE_SETS.general, [context])

  useEffect(() => {
    setMessageIndex(0)
  }, [context])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % messages.length)
    }, 1800)

    return () => window.clearInterval(timer)
  }, [messages])

  return (
    <div className={`ts-loading-screen ts-loading-screen--${variant}`} role="status" aria-live="polite" aria-label="Loading">
      <div className="ts-loading-screen__content">
        <div className="ts-loading-screen__frame">
          <video
            className="ts-loading-screen__video"
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
          >
            <source src="/loading-loop.webm" type="video/webm" />
            <source src="/loading-loop.mp4" type="video/mp4" />
          </video>
        </div>

        <div className="ts-loading-screen__message-wrap">
          <AnimatePresence mode="wait">
            <motion.p
              key={`${context}-${messageIndex}`}
              className="ts-loading-screen__message"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.28, ease: 'easeOut' }}
            >
              {messages[messageIndex]}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}