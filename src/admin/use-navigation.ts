import { useCallback, useEffect, useRef, useState } from "react"
import { adminApi } from "./api"
import { LIBRARY, parseRoute, routeHash, sameRoute, transition, type Route } from "./routes"
import type { Editor } from "./use-editor"

export interface GoOptions {
  /** Replace the current history entry instead of adding one. */
  replace?: boolean
  /** The editor already holds the target pack (just created or imported): no confirmation, no load. */
  opened?: boolean
}

interface Go extends GoOptions {
  /** The URL already shows the target (Back, Forward or a typed address). */
  fromUrl?: boolean
  /** Unsaved changes were already confirmed. */
  confirmed?: boolean
}

/** Position of an admin history entry, so a guarded Back or Forward can be undone exactly. */
const indexOf = (state: unknown): number | null => {
  const value = (state as { adminIndex?: unknown } | null)?.adminIndex
  return typeof value === "number" ? value : null
}

/**
 * Where the admin is. The URL hash is the source of truth, so Back, Forward,
 * refresh and direct links reach the same place as clicks:
 *
 * - In-app links navigate without first changing the URL, so a navigation that
 *   needs confirming never leaves a stray history entry.
 * - Opening another pack while the editor has unsaved changes asks first
 *   (`confirmLeave`). Back or Forward to another pack is undone until the
 *   admin agrees, then replayed, so the history stays in order.
 * - Every navigation supersedes the previous one, so a slow pack load that
 *   finishes after the admin moved on is ignored.
 * - A pack that is not in the library, or cannot be read, falls back to the
 *   library with a message.
 */
export function useNavigation({ editor, ready, packIds, start, confirmLeave, onUnavailable }: {
  editor: Editor
  /** The library has loaded. */
  ready: boolean
  /** Pack IDs in the library now. */
  packIds: () => string[]
  /** Where to go when the URL names nowhere. */
  start: () => Route
  confirmLeave: () => Promise<boolean>
  /** A pack could not be opened: not in the library (reason null), or unreadable. */
  onUnavailable: (packId: string, reason: string | null) => void
}) {
  const [route, setRoute] = useState<Route | null>(null)
  /** The pack being loaded for the current route. */
  const [loading, setLoading] = useState<string | null>(null)
  const shown = useRef<Route | null>(null)
  const latest = useRef(0)
  const index = useRef(0)
  /** A Back or Forward the admin confirmed and that is now being replayed. */
  const approved = useRef<string | null>(null)

  const write = (route: Route, replace: boolean) => {
    if (replace || window.location.hash === routeHash(route)) window.history.replaceState({ adminIndex: index.current }, "", routeHash(route))
    else window.history.pushState({ adminIndex: ++index.current }, "", routeHash(route))
  }

  const editorNow = () => {
    const now = editor.current.current
    return now.opened ? { packId: now.opened.packId, dirty: now.dirty } : null
  }

  const go = async (target: Route, { replace = false, opened = false, fromUrl = false, confirmed = false }: Go = {}): Promise<boolean> => {
    const id = ++latest.current
    const step = opened ? "stay" : transition(editorNow(), target)
    if (step === "confirm" && !confirmed && (!(await confirmLeave()) || id !== latest.current)) return false
    if (target.page === "pack" && step !== "stay" && !packIds().includes(target.packId)) {
      onUnavailable(target.packId, null)
      return go(LIBRARY, { replace: true })
    }
    if (!fromUrl) write(target, replace)
    shown.current = target
    setRoute(target)
    if (step === "stay" || target.page !== "pack") {
      setLoading(null)
      return true
    }
    setLoading(target.packId)
    try {
      const head = await adminApi.head(target.packId)
      if (id !== latest.current) return false
      editor.showHead(head)
      setLoading(null)
      return true
    } catch (e) {
      if (id !== latest.current) return false
      setLoading(null)
      onUnavailable(target.packId, (e as Error).message)
      return go(LIBRARY, { replace: true })
    }
  }
  const goRef = useRef(go)
  goRef.current = go

  // The first route: the URL's, else wherever the admin starts.
  useEffect(() => {
    if (!ready || shown.current) return
    index.current = indexOf(window.history.state) ?? 0
    void goRef.current(parseRoute(window.location.hash) ?? start(), { replace: true })
  }, [ready, start])

  // Back, Forward and typed addresses.
  useEffect(() => {
    if (!ready) return
    const onHash = async () => {
      const given = parseRoute(window.location.hash)
      const target = given ?? start()
      const at = indexOf(window.history.state)
      if (approved.current === window.location.hash) {
        approved.current = null
        if (at !== null) index.current = at
        void goRef.current(target, { fromUrl: true, confirmed: true })
        return
      }
      if (shown.current && sameRoute(target, shown.current)) {
        if (at !== null) index.current = at
        return
      }
      if (!given) return void goRef.current(target, { replace: true })
      if (transition(editorNow(), target) === "confirm" && shown.current) {
        // Show where the admin still is until they decide.
        const delta = at !== null ? at - index.current : 0
        if (delta) window.history.go(-delta)
        else window.history.replaceState({ adminIndex: index.current }, "", routeHash(shown.current))
        if (!(await confirmLeave())) return
        if (delta) {
          approved.current = routeHash(target)
          window.history.go(delta)
        } else void goRef.current(target, { confirmed: true })
        return
      }
      if (at === null) window.history.replaceState({ adminIndex: ++index.current }, "", window.location.hash)
      else index.current = at
      void goRef.current(target, { fromUrl: true })
    }
    const listener = () => void onHash()
    window.addEventListener("hashchange", listener)
    return () => window.removeEventListener("hashchange", listener)
  }, [ready, start, confirmLeave])

  // In-app links: navigate first, so the URL changes only once the navigation is allowed.
  useEffect(() => {
    if (!ready) return
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const link = (e.target as Element | null)?.closest?.("a[href^='#/']")
      if (!(link instanceof HTMLAnchorElement) || link.target) return
      const target = parseRoute(link.getAttribute("href") ?? "")
      if (!target) return
      e.preventDefault()
      void goRef.current(target)
    }
    document.addEventListener("click", onClick)
    return () => document.removeEventListener("click", onClick)
  }, [ready])

  const navigate = useCallback((target: Route, options?: GoOptions) => goRef.current(target, options), [])
  /** Changes with every navigation, including ones that were refused or superseded. */
  const position = useCallback(() => latest.current, [])
  return { route, loading, navigate, position }
}
