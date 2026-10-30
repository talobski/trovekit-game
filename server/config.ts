import { accessSync, constants, existsSync, mkdirSync, realpathSync, statSync } from "node:fs"
import { isIP } from "node:net"
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path"
import { DEFAULT_LIMITS, normalizeIp, resolveLimits, type Limits } from "./limits.ts"

export const LIMIT_ENV: Record<keyof Limits, string> = {
  maxRooms: "MAX_ROOMS", roomCreatesPerMinute: "ROOM_CREATES_PER_MINUTE", requestsPerMinute: "REQUESTS_PER_MINUTE",
  maxConnections: "MAX_CONNECTIONS", connectionsPerIp: "CONNECTIONS_PER_IP", maxWebSockets: "MAX_WEBSOCKETS",
  webSocketsPerIp: "WEBSOCKETS_PER_IP", webSocketsPerSession: "WEBSOCKETS_PER_SESSION", messagesPerMinute: "WS_MESSAGES_PER_MINUTE",
  maxMessageBytes: "WS_MAX_MESSAGE_BYTES", maxBufferedBytes: "WS_MAX_BUFFERED_BYTES", authTimeoutMs: "WS_AUTH_TIMEOUT_MS",
  heartbeatMs: "WS_HEARTBEAT_MS", roomIdleMs: "ROOM_IDLE_MS", requestTimeoutMs: "REQUEST_TIMEOUT_MS",
  headersTimeoutMs: "HEADERS_TIMEOUT_MS", connectionIdleMs: "CONNECTION_IDLE_MS", maxRateClients: "MAX_RATE_CLIENTS",
}

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number) {
  const raw = env[name]
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`)
  return value
}

/** Resolve existing ancestors too, when the leaf directory has not been made. */
function canonicalPath(path: string): string {
  if (existsSync(path)) return realpathSync(path)
  const parent = dirname(path)
  return parent === path ? path : resolve(canonicalPath(parent), basename(path))
}

/** Pure parsing: no library is opened until every setting has been checked. */
export function serverConfig(root: string, env: NodeJS.ProcessEnv, admin = false, dev = false) {
  const port = integer(env, admin ? "ADMIN_PORT" : "PORT", admin ? 4748 : 4747, 1, dev ? 65525 : 65535)
  const host = admin ? "127.0.0.1" : env.HOST ?? "0.0.0.0"
  if (!isIP(host) && host !== "localhost") throw new Error("HOST must be an IP address or localhost")
  const rawData = env.TROVEKIT_DATA ?? resolve(root, "data")
  if (!rawData.trim() || rawData.includes("\0") || rawData.startsWith("~")) throw new Error("TROVEKIT_DATA must be a nonempty path (expand ~ in the shell)")
  const dataDir = resolve(rawData)
  const canonical = canonicalPath(dataDir)
  const inside = (parent: string) => { const rel = relative(parent, canonical); return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`) }
  if (canonical === dirname(canonical) || canonical === realpathSync(root) || inside(canonicalPath(resolve(root, "dist"))) || inside(canonicalPath(resolve(root, "public")))) throw new Error("TROVEKIT_DATA must be a dedicated directory outside the public/build tree")
  if (existsSync(dataDir) && !statSync(dataDir).isDirectory()) throw new Error("TROVEKIT_DATA must be a directory")
  const botDelayMs = integer(env, "BOT_DELAY_MS", 1200, 0, 60_000)
  const limits = resolveLimits(Object.fromEntries(Object.entries(LIMIT_ENV).map(([key, name]) => [key, integer(env, name, DEFAULT_LIMITS[key as keyof Limits], 1, 2_147_483_647)])))
  let publicOrigin: string | undefined
  if (env.PUBLIC_ORIGIN !== undefined) {
    try {
      const url = new URL(env.PUBLIC_ORIGIN)
      if (!["http:", "https:"].includes(url.protocol) || url.origin !== env.PUBLIC_ORIGIN) throw new Error()
      publicOrigin = url.origin
    } catch { throw new Error("PUBLIC_ORIGIN must be an exact http(s) origin, with no path, credentials, query or trailing slash") }
  }
  const trustedProxies = env.TRUSTED_PROXIES === undefined ? [] : env.TRUSTED_PROXIES.split(",").map(s => s.trim())
  if (trustedProxies.some(ip => !isIP(ip))) throw new Error("TRUSTED_PROXIES must be a comma-separated list of exact proxy IP addresses")
  return { port, host, dataDir, botDelayMs, limits, publicOrigin, trustedProxies: trustedProxies.map(normalizeIp) }
}

export function prepareDataDirectory(dataDir: string) {
  try {
    for (const part of ["", "rooms", "assets", "content", "content/versions"]) {
      const directory = resolve(dataDir, part)
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      accessSync(directory, constants.R_OK | constants.W_OK | constants.X_OK)
    }
  } catch (e) { throw new Error(`Cannot use TROVEKIT_DATA directory ${dataDir}: ${(e as Error).message}`) }
}
