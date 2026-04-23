import { motion } from 'framer-motion'
import { usePageTransition } from '../../context/PageTransitionContext'
import { cardBackgroundVariants, cardMotionVariants } from '../../lib/pageTransitionMotion'

export default function Card({ className = '', children, ...props }) {
  const transition = usePageTransition()

  if (!transition) {
    return (
      <section className={`ts-card ${className}`.trim()} {...props}>
        {children}
      </section>
    )
  }

  return (
    <motion.section className={`ts-card ${className}`.trim()} variants={cardMotionVariants} {...props}>
      <motion.span className="ts-card-transition-bg" aria-hidden="true" variants={cardBackgroundVariants} />
      <div className="ts-card-transition-content">{children}</div>
    </motion.section>
  )
}
