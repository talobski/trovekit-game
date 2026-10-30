import { useSyncExternalStore } from "react"

const listeners = new Set<() => void>()
window.addEventListener("popstate", () => listeners.forEach((l) => l()))

export function navigate(path: string, replace = false) {
  if (replace) history.replaceState(null, "", path)
  else history.pushState(null, "", path)
  listeners.forEach((l) => l())
  window.scrollTo(0, 0)
}

export function usePath(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => location.pathname
  )
}

export const ROOM_CODE = /^[A-Z0-9]{6}$/
