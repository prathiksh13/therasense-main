import { createContext, useContext } from 'react'

export const PageTransitionContext = createContext(null)

export function usePageTransition() {
  return useContext(PageTransitionContext)
}
