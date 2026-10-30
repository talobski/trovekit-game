import type { Server } from "node:http"
import { WebSocketServer, type WebSocket, type ServerOptions } from "ws"
import { HttpError, rejectUpgrade, requestPath } from "./http.ts"
import { checkOrigin, clientIp, RateLimit, type Limits } from "./limits.ts"
import { RoomError, type RoomService } from "./rooms.ts"

type Subscription = { ws: WebSocket; code: string; playerId: string }

export function roomWebSockets(server: Server, rooms: RoomService, limits: Limits, trusted: Set<string>, publicOrigin?: string) {
  // ws supports closeTimeout; @types/ws currently omits this option.
  const settings: ServerOptions & { closeTimeout: number; maxFragments: number; maxBufferedChunks: number } = { noServer: true, maxPayload: limits.maxMessageBytes, perMessageDeflate: false, closeTimeout: 1000, maxFragments: 64, maxBufferedChunks: 128 }
  const wss = new WebSocketServer(settings)
  let accepting = true
  const subscriptions = new Map<WebSocket, Subscription>()
  const ips = new Map<string, number>()
  const upgrades = new RateLimit(limits.maxRateClients)
  const live = new Map<WebSocket, boolean>()

  const send = (ws: WebSocket, message: string) => {
    if (ws.readyState !== ws.OPEN) return
    if (ws.bufferedAmount + Buffer.byteLength(message) > limits.maxBufferedBytes) { ws.terminate(); return }
    ws.send(message, error => { if (error) ws.terminate() })
  }
  const revoke = (ws: WebSocket) => {
    const sub = subscriptions.get(ws)
    subscriptions.delete(ws)
    send(ws, JSON.stringify({ type: "error", code: "UNAUTHORIZED", message: "Your room session has ended or expired" }))
    ws.close(4003, "session no longer valid")
    if (sub) rooms.disconnect(sub.code, sub.playerId)
  }
  const unsubscribe = rooms.onChange(code => {
    let message: string | undefined
    for (const sub of [...subscriptions.values()]) {
      if (sub.code !== code) continue
      if (!rooms.hasSession(sub.code, sub.playerId)) { revoke(sub.ws); continue }
      try {
        message ??= JSON.stringify({ type: "room", room: rooms.viewOf(rooms.getRoom(code)!) })
        send(sub.ws, message)
      } catch { sub.ws.close(1011, "room unavailable") }
    }
  })
  server.on("upgrade", (req, socket, head) => {
    try {
      if (!accepting) return rejectUpgrade(socket, 503)
      if (requestPath(req) !== "/ws" || req.url !== "/ws") return rejectUpgrade(socket, 404)
      checkOrigin(req, publicOrigin)
      const ip = clientIp(req, trusted)
      if (!upgrades.take(ip, limits.requestsPerMinute)) return rejectUpgrade(socket, 429)
      if (wss.clients.size >= limits.maxWebSockets || (ips.get(ip) ?? 0) >= limits.webSocketsPerIp) return rejectUpgrade(socket, 503)
      wss.handleUpgrade(req, socket, head, ws => {
        ips.set(ip, (ips.get(ip) ?? 0) + 1)
        ws.once("close", () => { const count = (ips.get(ip) ?? 1) - 1; if (count) ips.set(ip, count); else ips.delete(ip) })
        wss.emit("connection", ws, req)
      })
    } catch (e) { rejectUpgrade(socket, e instanceof HttpError ? e.status : 400) }
  })
  wss.on("connection", ws => {
    live.set(ws, true)
    const timeout = setTimeout(() => ws.terminate(), limits.authTimeoutMs)
    const messages = new RateLimit(1)
    const withinRate = () => {
      if (!messages.take("socket", limits.messagesPerMinute)) { ws.terminate(); return false }
      return true
    }
    ws.on("error", () => ws.terminate())
    ws.on("pong", () => { if (withinRate()) live.set(ws, true) })
    ws.on("ping", withinRate)
    ws.on("message", (raw, binary) => {
      if (!withinRate()) return
      // This protocol accepts one text hello; subsequent messages have no use.
      if (binary || subscriptions.has(ws)) { ws.close(1008, "unexpected message"); return }
      try {
        const msg = JSON.parse(String(raw)) as { type?: string; code?: string; token?: string }
        if (msg?.type !== "hello") throw new Error("expected hello")
        const { room, player } = rooms.authenticate(msg.code, msg.token)
        const count = [...subscriptions.values()].filter(s => s.code === room.code && s.playerId === player.id).length
        if (count >= limits.webSocketsPerSession) { ws.close(1008, "session connection limit"); return }
        subscriptions.set(ws, { ws, code: room.code, playerId: player.id })
        clearTimeout(timeout)
        rooms.connect(room.code, player.id)
      } catch (e) {
        send(ws, JSON.stringify(e instanceof RoomError ? { type: "error", code: e.code, message: e.message } : { type: "error", code: "BAD_HELLO", message: "Could not join room updates" }))
        ws.close(4003, "unauthorized")
      }
    })
    ws.once("close", () => {
      clearTimeout(timeout); live.delete(ws)
      const sub = subscriptions.get(ws)
      subscriptions.delete(ws)
      if (sub) rooms.disconnect(sub.code, sub.playerId)
    })
  })
  const heartbeat = setInterval(() => {
    upgrades.sweep()
    for (const ws of wss.clients) {
      const sub = subscriptions.get(ws)
      if (sub && !rooms.hasSession(sub.code, sub.playerId)) { revoke(ws); continue }
      if (!live.get(ws) || ws.bufferedAmount > limits.maxBufferedBytes) { ws.terminate(); continue }
      live.set(ws, false)
      if (ws.readyState === ws.OPEN) ws.ping(undefined, undefined, error => { if (error) ws.terminate() })
    }
  }, limits.heartbeatMs)
  heartbeat.unref()
  const dispose = () => {
    clearInterval(heartbeat); unsubscribe(); upgrades.clear()
    for (const ws of wss.clients) ws.terminate()
    wss.close()
  }
  const close = () => { accepting = false; for (const ws of wss.clients) ws.close(1001, "server shutting down") }
  return { wss, dispose, close }
}
