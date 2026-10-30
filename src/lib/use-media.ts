import { useSyncExternalStore } from "react"

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query)
      mql.addEventListener("change", cb)
      return () => mql.removeEventListener("change", cb)
    },
    () => window.matchMedia(query).matches
  )
}

export const useDesktop = () => useMedia("(min-width: 768px)")
