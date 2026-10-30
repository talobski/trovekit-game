import { useCallback, useEffect, useMemo, useState } from "react"
import { createContext as createGameContext, type Action, type GameContext } from "@/engine/client"
import { api, isApiError, type ApiError, type RoomView, type Session } from "./api"

import { presentPack } from "./game/presentation"

export type Connection = "connecting" | "live" | "polling"

const POLL_MS = 2500

/**
 * Keeps one room in sync: WebSocket push when available, polling otherwise.
 * The server is the only authority; this hook never changes state locally.
 */
export function useRoom(code: string, session: Session) {
  const [room, setRoom] = useState<RoomView | null>(null)
  const [content, setContent] = useState<{ ctx: GameContext; hash: string } | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [connection, setConnection] = useState<Connection>("connecting")

  const accept = useCallback((next: RoomView) => {
    setRoom((prev) => {
      // Ignore out-of-order snapshots of the same game.
      if (prev && prev.status === next.status && next.revision < prev.revision && prev.players.length === next.players.length) return prev
      return next
    })
    setError(null)
  }, [])

  const refresh = useCallback(async () => {
    try {
      accept(await api.view(code, session.token))
    } catch (e) {
      if (isApiError(e) && e.code !== "OFFLINE") setError(e)
    }
  }, [accept, code, session.token])

  // Content snapshot: fetched once per hash.
  const hash = room?.content.hash
  useEffect(() => {
    if (!hash || content?.hash === hash) return
    let cancelled = false
    api.content(code, session.token).then(
      (c) => !cancelled && setContent({ ctx: createGameContext(presentPack(c.pack), c.rules), hash: c.hash }),
      (e) => !cancelled && isApiError(e) && setError(e)
    )
    return () => {
      cancelled = true
    }
  }, [code, content?.hash, hash, session.token])

  // WebSocket with reconnect; polling while it is down.
  useEffect(() => {
    let ws: WebSocket | null = null
    let closed = false
    let attempt = 0
    let poll: ReturnType<typeof setInterval> | null = null
    let retry: ReturnType<typeof setTimeout> | null = null

    const startPolling = () => {
      setConnection("polling")
      if (!poll) poll = setInterval(refresh, POLL_MS)
    }
    const stopPolling = () => {
      if (poll) clearInterval(poll)
      poll = null
    }

    const open = () => {
      if (closed) return
      const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`
      try {
        ws = new WebSocket(url)
      } catch {
        startPolling()
        return
      }
      ws.onopen = () => {
        attempt = 0
        ws?.send(JSON.stringify({ type: "hello", code, token: session.token }))
      }
      ws.onmessage = (event) => {
        const msg = JSON.parse(String(event.data))
        if (msg.type === "room") {
          setConnection("live")
          stopPolling()
          accept(msg.room)
        } else if (msg.type === "gone") {
          setError({ status: 404, code: "ROOM_NOT_FOUND", message: "This room does not exist or has expired" })
        } else if (msg.type === "error") {
          setError({ status: 401, code: msg.code, message: msg.message })
          closed = true
        }
      }
      ws.onclose = () => {
        if (closed) return
        startPolling()
        attempt++
        retry = setTimeout(open, Math.min(15000, 500 * 2 ** attempt))
      }
    }

    refresh()
    open()
    const onVisible = () => document.visibilityState === "visible" && refresh()
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      closed = true
      stopPolling()
      if (retry) clearTimeout(retry)
      ws?.close()
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [accept, code, refresh, session.token])

  const act = useCallback(
    async (action: Action) => {
      if (!room) throw { status: 0, code: "NOT_READY", message: "Still loading" } satisfies ApiError
      try {
        const res = await api.act(code, session.token, room.revision, action)
        accept(res.room)
        return res
      } catch (e) {
        if (isApiError(e) && e.code === "STALE_REVISION") refresh()
        throw e
      }
    },
    [accept, code, refresh, room, session.token]
  )

  const me = useMemo(() => room?.players.find((p) => p.id === session.playerId) ?? null, [room, session.playerId])

  return { room, content: content && content.hash === hash ? content.ctx : null, error, connection, act, refresh, me }
}
