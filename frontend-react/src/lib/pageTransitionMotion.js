export const NAV_EXIT_DURATION_MS = 480

export const pageShellVariants = {
  initial: { opacity: 0, y: 8 },
  enter: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.26, ease: [0.2, 0.8, 0.2, 1] },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.15 },
  },
}

export const pageCardContainerVariants = {
  initial: {
    transition: {
      staggerChildren: 0.04,
      staggerDirection: 1,
    },
  },
  enter: {
    transition: {
      staggerChildren: 0.06,
      staggerDirection: 1,
    },
  },
  exit: {
    transition: {
      staggerChildren: 0.04,
      staggerDirection: -1,
    },
  },
}

export const cardMotionVariants = {
  initial: {
    y: 60,
    scale: 0.95,
    opacity: 0,
  },
  enter: {
    y: 0,
    scale: 1,
    opacity: 1,
    transition: {
      duration: 0.4,
      ease: [0.22, 1, 0.36, 1],
    },
  },
  exit: {
    y: -100,
    scale: 1.03,
    opacity: 0,
    transition: {
      duration: 0.3,
      ease: [0.4, 0, 0.2, 1],
    },
  },
}



export const cardBackgroundVariants = {
  enter: {
    opacity: 1,
    transition: {
      duration: 0.25,
      ease: 'easeOut',
    },
  },
  exit: {
    opacity: [1, 0, 0],
    transition: {
      duration: 0.35, // Slightly before the 400ms mark
      times: [0, 0.8, 1],
      ease: 'easeOut',
    },
  },
}

