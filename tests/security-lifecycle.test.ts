import { rmSync } from "node:fs"
import { connect, type AddressInfo } from "node:net"
import { once } from "node:events"
import WebSocket from "ws"
import { afterEach, expect, it } from "vitest"
import { createGameServer, type GameServerOptions } from "../server/game-server"
import { RateLimit } from "../server/limits"
import { fixtureDataDir } from "./fixtures"

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanups.splice(0)) await close() })
async function start(options: Partial<GameServerOptions> = {}) {
  const dataDir = fixtureDataDir("trovekit-security-")
  const g = createGameServer({ dataDir, ...options })
  await new Promise<void>(r => g.server.listen(0, "127.0.0.1", r))
  const base = `http://127.0.0.1:${(g.server.address() as AddressInfo).port}`
  cleanups.push(async () => {
    for (const ws of g.wss.clients) ws.terminate()
    g.connections.destroy()
    await new Promise<void>(r => g.server.close(() => r()))
    rmSync(dataDir, { recursive: true, force: true })
  })
  return { ...g, base }
}
const post = (base: string, path: string, body: unknown, token?: string, headers = {}) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(body) })
async function socket(base: string, options: WebSocket.ClientOptions = {}) {
  const ws = new WebSocket(base.replace("http", "ws") + "/ws", options)
  ws.on("error", () => {})
  await once(ws, "open")
  return ws
}
async function hello(ws: WebSocket, code: string, token: string) {
  const next = once(ws, "message")
  ws.send(JSON.stringify({ type: "hello", code, token }))
  return JSON.parse(String((await next)[0]))
}
async function rejected(base: string, options: WebSocket.ClientOptions) {
  const ws = new WebSocket(base.replace("http", "ws") + "/ws", options)
  ws.on("error", () => {})
  const [, response] = await once(ws, "unexpected-response")
  response.resume(); ws.terminate()
  return response.statusCode
}

it("bounds rate-limit memory and restores capacity after expiry", () => {
  let now = 0
  const rate = new RateLimit(1, () => now)
  expect(rate.take("a", 1)).toBe(true)
  expect(rate.take("a", 1)).toBe(false)
  expect(rate.take("b", 1)).toBe(false)
  now = 60_000
  expect(rate.take("b", 1)).toBe(true)
})
it("limits requests and ignores untrusted forwarded IPs", async () => {
  const { base } = await start({ limits: { requestsPerMinute: 2 } })
  for (const ip of ["192.0.2.1", "192.0.2.2"]) expect((await fetch(base + "/api/packs", { headers: { "x-forwarded-for": ip } })).status).toBe(200)
  const response = await fetch(base + "/api/packs", { headers: { "x-forwarded-for": "192.0.2.3" } })
  expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("60")
})
it("accepts one overwritten IP from an explicitly trusted proxy only", async () => {
  const { base } = await start({ trustedProxies: ["127.0.0.1"], limits: { requestsPerMinute: 1 } })
  expect((await fetch(base + "/api/packs")).status).toBe(400)
  expect((await fetch(base + "/api/packs", { headers: { "x-forwarded-for": "192.0.2.1, 192.0.2.2" } })).status).toBe(400)
  for (const ip of ["192.0.2.1", "192.0.2.2"]) expect((await fetch(base + "/api/packs", { headers: { "x-forwarded-for": ip } })).status).toBe(200)
})
it("limits room creation independently of requests", async () => {
  const { base } = await start({ limits: { roomCreatesPerMinute: 1 } })
  expect((await post(base, "/api/rooms", { name: "Host" })).status).toBe(201)
  expect((await post(base, "/api/rooms", { name: "Host" })).status).toBe(429)
  expect((await fetch(base + "/api/packs")).status).toBe(200)
})
it("bounds concurrent rooms and releases capacity on expiry", async () => {
  let now = Date.now()
  const { rooms } = await start({ now: () => now, limits: { maxRooms: 1, roomIdleMs: 100 } })
  const host = rooms.create("Host")
  expect(() => rooms.create("Another")).toThrow(/room limit/)
  now += 101
  rooms.sweep()
  expect(rooms.hasSession(host.code, host.playerId)).toBe(false)
  expect(rooms.create("Another").code).toBeTruthy()
})
it("checks browser origins for HTTP and WebSocket while permitting direct same-origin", async () => {
  const { base } = await start()
  expect(await rejected(base, { origin: "https://evil.example" })).toBe(403)
  expect(await rejected(base, { origin: "null" })).toBe(403)
  expect((await post(base, "/api/rooms", { name: "Host" }, undefined, { origin: "https://evil.example" })).status).toBe(403)
  const ws = await socket(base, { origin: base }); ws.terminate()
})
it("checks the configured HTTPS origin behind a proxy", async () => {
  const { base } = await start({ publicOrigin: "https://game.example" })
  expect(await rejected(base, { origin: base })).toBe(403)
  const ws = await socket(base, { origin: "https://game.example" }); ws.terminate()
})
it("closes unauthenticated sockets within the configured deadline", async () => {
  const { base } = await start({ limits: { authTimeoutMs: 50 } })
  const ws = await socket(base)
  expect((await once(ws, "close"))[0]).toBe(1006)
})
it("rejects invalid sessions without leaking a room snapshot", async () => {
  const { base, rooms } = await start()
  const host = rooms.create("Host")
  const ws = await socket(base)
  const message = await hello(ws, host.code, "invalid-token-xxxxxxxxxxxxxxxxxxx")
  expect(message).toMatchObject({ type: "error", code: "UNAUTHORIZED" })
  expect(message.room).toBeUndefined()
  await once(ws, "close")
})
it("revokes leaving players and allows valid reconnects", async () => {
  const { base, rooms } = await start()
  const host = rooms.create("Host"), guest = rooms.join(host.code, "Guest")
  const ws = await socket(base)
  expect((await hello(ws, host.code, guest.token)).type).toBe("room")
  const closed = once(ws, "close")
  const received: string[] = []; ws.on("message", data => received.push(String(data)))
  rooms.leave(host.code, guest.token)
  rooms.addBot(host.code, host.token)
  await closed
  expect(received.every(raw => JSON.parse(raw).type !== "room")).toBe(true)
  expect(rooms.hasSession(host.code, guest.playerId)).toBe(false)
  const reconnect = await socket(base)
  expect((await hello(reconnect, host.code, host.token)).type).toBe("room")
  reconnect.terminate()
})
it("revokes expired rooms and removes socket presence", async () => {
  let now = Date.now()
  const { base, rooms } = await start({ now: () => now, limits: { roomIdleMs: 1000 } })
  const host = rooms.create("Host"), ws = await socket(base)
  await hello(ws, host.code, host.token)
  const closed = once(ws, "close")
  now += 1001; expect(rooms.sweep()).toEqual([host.code])
  await closed
  expect(rooms.getRoom(host.code)).toBeUndefined()
})
it("bounds per-session and per-IP WebSocket connections", async () => {
  const { base, rooms } = await start({ limits: { webSocketsPerSession: 1, webSocketsPerIp: 2 } })
  const host = rooms.create("Host"), a = await socket(base), b = await socket(base)
  await hello(a, host.code, host.token)
  expect(await rejected(base, {})).toBe(503)
  const closed = once(b, "close"); b.send(JSON.stringify({ type: "hello", code: host.code, token: host.token }))
  expect((await closed)[0]).toBe(1008)
  a.terminate()
})
it("closes oversized messages without crashing the server", async () => {
  const { base } = await start({ limits: { maxMessageBytes: 64 } })
  const ws = await socket(base), closed = once(ws, "close")
  ws.send("x".repeat(65))
  expect((await closed)[0]).toBe(1009)
  expect((await fetch(base + "/api/packs")).status).toBe(200)
})
it("terminates clients that do not answer heartbeats", async () => {
  const { base, rooms } = await start({ limits: { heartbeatMs: 30 } })
  const host = rooms.create("Host")
  const ws = await socket(base, { autoPong: false })
  await hello(ws, host.code, host.token)
  expect((await once(ws, "close"))[0]).toBe(1006)
})
it("terminates slow consumers before growing their send queue", async () => {
  const { base, rooms } = await start({ limits: { maxBufferedBytes: 64 } })
  const host = rooms.create("Host"), ws = await socket(base), closed = once(ws, "close")
  ws.send(JSON.stringify({ type: "hello", code: host.code, token: host.token }))
  expect((await closed)[0]).toBe(1006)
})
it("bounds control-message frequency", async () => {
  const { base } = await start({ limits: { messagesPerMinute: 2 } })
  const ws = await socket(base), closed = once(ws, "close")
  ws.ping(); ws.ping(); ws.ping()
  expect((await closed)[0]).toBe(1006)
})

it("enforces a global WebSocket cap", async () => {
  const { base } = await start({ limits: { maxWebSockets: 1 } })
  const ws = await socket(base)
  expect(await rejected(base, {})).toBe(503)
  ws.terminate()
})
it.each([{ maxConnections: 1 }, { connectionsPerIp: 1 }])("bounds raw TCP connections: %j", async limits => {
  const { base } = await start({ limits })
  const port = Number(new URL(base).port)
  const first = connect(port, "127.0.0.1"); await once(first, "connect")
  const second = connect(port, "127.0.0.1"); second.on("error", () => {})
  await once(second, "close")
  first.destroy()
})
