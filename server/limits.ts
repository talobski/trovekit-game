import type { IncomingMessage, Server } from "node:http"
import { isIP, type Socket } from "node:net"
import { HttpError } from "./http.ts"

/** Small-instance defaults. All limits remain enabled; tests can raise rates. */
export const DEFAULT_LIMITS = {
  maxRooms: 100,
  roomCreatesPerMinute: 6,
  requestsPerMinute: 600,
  maxConnections: 512,
  connectionsPerIp: 64,
  maxWebSockets: 256,
  webSocketsPerIp: 16,
  webSocketsPerSession: 4,
  messagesPerMinute: 30,
  maxMessageBytes: 4096,
  maxBufferedBytes: 1024 * 1024,
  authTimeoutMs: 5000,
  heartbeatMs: 30_000,
  roomIdleMs: 7 * 24 * 3600_000,
  requestTimeoutMs: 15_000,
  headersTimeoutMs: 10_000,
  connectionIdleMs: 30_000,
  maxRateClients: 4096,
}
export type Limits = typeof DEFAULT_LIMITS

export function resolveLimits(input: Partial<Limits> = {}): Limits {
  const limits = { ...DEFAULT_LIMITS, ...input }
  for (const [key, value] of Object.entries(limits)) {
    if (!(key in DEFAULT_LIMITS) || !Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) throw new Error(`Invalid limit ${key}: expected a positive integer up to 2147483647`)
  }
  if (limits.headersTimeoutMs > limits.requestTimeoutMs) throw new Error("headersTimeoutMs must not exceed requestTimeoutMs")
  return limits
}

export const normalizeIp = (ip: string) => ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip

/** Only an explicitly trusted immediate peer may supply a SINGLE client IP.
 * The proxy must overwrite X-Forwarded-For, never append a client-supplied list.
 */
export function clientIp(req: IncomingMessage, trusted: Set<string>): string {
  const peer = normalizeIp(req.socket.remoteAddress ?? "unknown")
  if (!trusted.has(peer)) return peer
  const forwarded = req.headers["x-forwarded-for"]
  if (typeof forwarded !== "string" || !isIP(forwarded)) throw new HttpError(400, "BAD_PROXY_HEADER", "Trusted proxy must provide one client IP")
  return normalizeIp(forwarded)
}

export function checkOrigin(req: IncomingMessage, publicOrigin?: string) {
  const origin = req.headers.origin
  if (origin === undefined) return // Non-browser clients still require bearer authentication.
  const expected = publicOrigin ?? `http://${req.headers.host}`
  if (origin !== expected) throw new HttpError(403, "ORIGIN_FORBIDDEN", "Origin is not allowed")
}

/** Fixed windows with bounded memory. At capacity, fail closed for new clients. */
export class RateLimit {
  private readonly clients = new Map<string, { until: number; count: number }>()
  private readonly capacity: number
  private readonly now: () => number
  constructor(capacity: number, now: () => number = Date.now) { this.capacity = capacity; this.now = now }
  take(key: string, max: number): boolean {
    const at = this.now()
    let bucket = this.clients.get(key)
    if (bucket && bucket.until <= at) { this.clients.delete(key); bucket = undefined }
    if (!bucket) {
      if (this.clients.size >= this.capacity) this.sweep()
      if (this.clients.size >= this.capacity) return false
      bucket = { until: at + 60_000, count: 0 }
      this.clients.set(key, bucket)
    }
    return ++bucket.count <= max
  }
  sweep() { for (const [key, b] of this.clients) if (b.until <= this.now()) this.clients.delete(key) }
  clear() { this.clients.clear() }
}

export function boundHttpConnections(server: Server, limits: Limits, trusted = new Set<string>()) {
  const sockets = new Set<Socket>()
  const perIp = new Map<string, number>()
  server.maxConnections = limits.maxConnections
  server.requestTimeout = limits.requestTimeoutMs
  server.headersTimeout = limits.headersTimeoutMs
  server.timeout = limits.connectionIdleMs
  server.keepAliveTimeout = 5000
  server.maxRequestsPerSocket = 1000
  server.on("connection", socket => {
    const ip = normalizeIp(socket.remoteAddress ?? "unknown")
    if (!trusted.has(ip) && (perIp.get(ip) ?? 0) >= limits.connectionsPerIp) { socket.destroy(); return }
    sockets.add(socket); perIp.set(ip, (perIp.get(ip) ?? 0) + 1)
    socket.on("error", () => socket.destroy())
    socket.once("close", () => {
      sockets.delete(socket)
      const count = (perIp.get(ip) ?? 1) - 1
      if (count) perIp.set(ip, count); else perIp.delete(ip)
    })
  })
  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n", () => socket.destroy())
  })
  return { destroy: () => { for (const socket of sockets) socket.destroy() } }
}
