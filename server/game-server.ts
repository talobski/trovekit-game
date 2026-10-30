import { accessSync, constants, existsSync } from "node:fs"
import { join } from "node:path"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { serveAsset } from "./assets.ts"
import { ContentStore } from "./content-store.ts"
import { bearer, HttpError, readJson, sendJson, requestPath } from "./http.ts"
import { boundHttpConnections, checkOrigin, clientIp, RateLimit, resolveLimits, type Limits } from "./limits.ts"
import { shutdownServer } from "./shutdown.ts"
import { roomWebSockets } from "./websockets.ts"
import { serveStatic } from "./static.ts"
import { RoomError, RoomService } from "./rooms.ts"
import { packBrand } from "../src/shared/content.ts"

export interface GameServerOptions {
  dataDir: string
  botDelayMs?: number
  /** Fixed game seeds (tests). */
  seed?: () => string
  /** Serve built files from this directory (production). */
  staticDir?: string
  /** Extra middleware run for non-API requests (Vite in development). */
  fallback?: (req: IncomingMessage, res: ServerResponse) => void
  now?: () => number
  limits?: Partial<Limits>
  publicOrigin?: string
  trustedProxies?: string[]
}

const BODY_LIMIT = 16 * 1024

export function createGameServer(options: GameServerOptions) {
  let closing = false
  const limits = resolveLimits(options.limits)
  const trusted = new Set(options.trustedProxies ?? [])
  const requests = new RateLimit(limits.maxRateClients, options.now)
  const creations = new RateLimit(limits.maxRateClients, options.now)
  const store = new ContentStore(options.dataDir)
  const rooms = new RoomService(options.dataDir, store, { now: options.now, botDelayMs: options.botDelayMs, seed: options.seed, maxRooms: limits.maxRooms, roomIdleMs: limits.roomIdleMs })

  async function api(req: IncomingMessage, res: ServerResponse, path: string) {
    const method = req.method ?? "GET"
    const token = bearer(req)
    if (path === "/api/packs" && method === "GET") {
      // Only the default: public players never see or choose other versions. Empty until a default is set.
      const active = store.active()?.content.pack
      // The published default's own description introduces the game on the home page.
      return sendJson(res, 200, active ? [{ id: "active", name: active.name, packId: active.id, default: true, ...packBrand(active), description: active.description ?? null }] : [])
    }
    if (path === "/api/rooms" && method === "POST") {
      if (!creations.take(clientIp(req, trusted), limits.roomCreatesPerMinute)) throw new HttpError(429, "RATE_LIMIT", "Too many room creation attempts; try again in a minute")
      const body = (await readJson(req, BODY_LIMIT)) as { name?: unknown; roomName?: unknown; packVersion?: unknown }
      return sendJson(res, 201, rooms.create(body.name, body.roomName, body.packVersion))
    }
    const m = path.match(/^\/api\/rooms\/([A-Za-z0-9]{1,12})(?:\/([a-z-]+))?$/)
    if (!m) throw new HttpError(404, "NOT_FOUND", "Not found")
    const [, code, sub] = m
    if (!sub && method === "GET") return sendJson(res, 200, rooms.view(code, token))
    if (sub === "preview" && method === "GET") return sendJson(res, 200, rooms.preview(code))
    if (sub === "content" && method === "GET") return sendJson(res, 200, rooms.content(code, token))
    if (method !== "POST") throw new HttpError(405, "METHOD", "Method not allowed")
    const body = await readJson(req, BODY_LIMIT)
    switch (sub) {
      case "join":
        return sendJson(res, 201, rooms.join(code, (body as { name?: unknown }).name))
      case "leave":
        rooms.leave(code, token)
        return sendJson(res, 200, { ok: true })
      case "add-bot":
        rooms.addBot(code, token)
        return sendJson(res, 201, rooms.view(code, token))
      case "remove-bot":
        rooms.removeBot(code, token, (body as { playerId?: unknown }).playerId)
        return sendJson(res, 200, rooms.view(code, token))
      case "start":
        rooms.start(code, token)
        return sendJson(res, 200, rooms.view(code, token))
      case "end":
        rooms.end(code, token)
        return sendJson(res, 200, rooms.view(code, token))
      case "actions": {
        const result = rooms.act(code, token, body)
        return sendJson(res, 200, { ...result, room: rooms.view(code, token) })
      }
    }
    throw new HttpError(404, "NOT_FOUND", "Not found")
  }

  const server: Server = createServer(async (req, res) => {
    try {
      if (closing) { res.setHeader("connection", "close"); return sendJson(res, 503, { ok: false }) }
      const path = requestPath(req)
      if (!requests.take(clientIp(req, trusted), limits.requestsPerMinute)) throw new HttpError(429, "RATE_LIMIT", "Too many requests; try again in a minute")
      if ((path === "/healthz" || path === "/readyz") && (req.method === "GET" || req.method === "HEAD")) {
        let ready = true
        if (path === "/readyz") {
          try { accessSync(join(options.dataDir, "rooms"), constants.R_OK | constants.W_OK | constants.X_OK) } catch { ready = false }
          ready &&= rooms.healthy && store.healthy && (!options.staticDir || existsSync(join(options.staticDir, "index.html")))
        }
        return sendJson(res, ready ? 200 : 503, { ok: ready })
      }
      if (path.startsWith("/api/")) checkOrigin(req, options.publicOrigin)
      if (serveAsset(options.dataDir, path, res)) return
      if (path.startsWith("/api/")) return await api(req, res, path)
      if (path.startsWith("/admin-api")) return sendJson(res, 404, { code: "NOT_FOUND", message: "Not found" })
      if (path.startsWith("/admin")) return sendJson(res, 404, { code: "NOT_FOUND", message: "Not found" })
      if (options.fallback) return options.fallback(req, res)
      if (options.staticDir) return serveStatic(req, res, options.staticDir, path, "index.html")
      sendJson(res, 404, { code: "NOT_FOUND", message: "Not found" })
    } catch (e) {
      if (e instanceof RoomError) return sendJson(res, e.status, { code: e.code, message: e.message, details: e.details })
      if (e instanceof HttpError && e.status === 429) res.setHeader("retry-after", "60")
      if (e instanceof HttpError) return sendJson(res, e.status, { code: e.code, message: e.message })
      console.error(e)
      sendJson(res, 500, { code: "SERVER_ERROR", message: "Something went wrong on the server" })
    }
  })

  const connections = boundHttpConnections(server, limits, trusted)
  const { wss, dispose, close: closeSockets } = roomWebSockets(server, rooms, limits, trusted, options.publicOrigin)
  const sweeper = setInterval(() => { rooms.sweep(); requests.sweep(); creations.sweep() }, Math.min(60_000, limits.roomIdleMs))
  sweeper.unref()
  server.on("close", () => {
    clearInterval(sweeper)
    rooms.dispose()
    dispose()
    requests.clear(); creations.clear()
  })

  let shutdown: Promise<void> | undefined
  const close = () => shutdown ??= shutdownServer(server, () => {
    closing = true; clearInterval(sweeper); rooms.dispose(); closeSockets()
  }, connections.destroy)
  return { server, rooms, store, wss, connections, close }
}
