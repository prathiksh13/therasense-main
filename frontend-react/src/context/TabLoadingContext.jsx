import { createContext, useContext } from 'react'

export const TabLoadingContext = createContext({
  tabLoading: false,
  setTabLoading: () => {},
})

export function useTabLoading() {
  return useContext(TabLoadingContext)
}
