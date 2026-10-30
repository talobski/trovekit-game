import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { request } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { afterEach, describe, expect, it } from "vitest"
import WebSocket from "ws"
import { chooseNormalAction } from "../src/bots"
import { createContext, type GameState, type Pack, type Rules } from "../src/engine"
import { createAdminServer } from "../server/admin-server"
import { createGameServer } from "../server/game-server"
import type { RoomView } from "../server/rooms"
import { fixtureDataDir } from "./fixtures"
import { starfallContent } from "./fixtures/starfall"

const open: { close: () => void }[] = []
afterEach(() => {
  while (open.length) open.pop()!.close()
})

async function startGame(dataDir = fixtureDataDir("trovekit-"), extra: { staticDir?: string; now?: () => number } = {}) {
  const g = createGameServer({ dataDir, ...extra })
  await new Promise<void>((r) => g.server.listen(0, "127.0.0.1", r))
  const base = `http://127.0.0.1:${(g.server.address() as AddressInfo).port}`
  open.push({ close: () => { g.server.closeAllConnections(); g.server.close() } })
  return { ...g, base, dataDir }
}

type Json = Record<string, unknown>
async function call(base: string, path: string, init: { method?: string; token?: string; body?: unknown } = {}) {
  const res = await fetch(base + path, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { "content-type": "application/json", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
  return { status: res.status, body: (await res.json()) as Json }
}

async function lobby(base: string, n: number) {
  const host = await call(base, "/api/rooms", { body: { name: "Host" } })
  expect(host.status).toBe(201)
  const code = host.body.code as string
  const players = [{ name: "Host", token: host.body.token as string, id: host.body.playerId as string }]
  for (let i = 1; i < n; i++) {
    const j = await call(base, `/api/rooms/${code}/join`, { body: { name: `P${i}` } })
    expect(j.status).toBe(201)
    players.push({ name: `P${i}`, token: j.body.token as string, id: j.body.playerId as string })
  }
  return { code, players }
}

async function playToEnd(base: string, code: string, players: { token: string; id: string }[]) {
  const content = (await call(base, `/api/rooms/${code}/content`, { token: players[0].token })).body as unknown as { pack: Pack; rules: Rules }
  const ctx = createContext(content.pack, content.rules)
  let view = (await call(base, `/api/rooms/${code}`, { token: players[0].token })).body as unknown as RoomView
  let guard = 0
  while (view.status === "playing") {
    if (guard++ > 800) throw new Error("game did not finish")
    const game = view.game!
    const active = players.find((p) => p.id === game.players[game.active].id)!
    let action = chooseNormalAction(ctx, game as unknown as GameState, `${code}:${game.revision}`)
    let r = await call(base, `/api/rooms/${code}/actions`, { token: active.token, body: { actionId: randomUUID(), expectedRevision: game.revision, action } })
    if (r.status !== 200) {
      // Bots occasionally propose a pass that is not allowed; fall back to any legal collect.
      const supply = game.supply.resources
      const kinds = Object.keys(supply).filter((k) => supply[k] > 0).slice(0, 3)
      action = { type: "collect", take: Object.fromEntries(kinds.map((k) => [k, 1])) }
      r = await call(base, `/api/rooms/${code}/actions`, { token: active.token, body: { actionId: randomUUID(), expectedRevision: game.revision, action } })
      if (r.status === 422 && (r.body.code === "DISCARD_REQUIRED")) {
        const me = game.players[game.active]
        let need = (r.body.details as { count: number }).count
        const discard: Record<string, number> = {}
        for (const [k, n] of Object.entries(me.resources)) {
          const t = Math.min(n, need)
          if (t) discard[k] = t
          need -= t
        }
        r = await call(base, `/api/rooms/${code}/actions`, { token: active.token, body: { actionId: randomUUID(), expectedRevision: game.revision, action: { ...action, discard: { resources: discard, wildcards: need } } } })
      }
    }
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    view = r.body.room as unknown as RoomView
  }
  return view
}

describe("rooms over HTTP", () => {
  it.each([2, 3, 4])("%i players play a full game from lobby to winner", async (n) => {
    const { base } = await startGame()
    const { code, players } = await lobby(base, n)
    const started = await call(base, `/api/rooms/${code}/start`, { token: players[0].token, body: {} })
    expect(started.status).toBe(200)
    const end = await playToEnd(base, code, players)
    expect(end.status).toBe("finished")
    expect(end.game!.result!.winners.length).toBeGreaterThan(0)
    expect(new Set(end.game!.players.map((p) => p.turns)).size).toBe(1)
    expect(end.game!.seed).toMatch(/^[0-9a-f]{32}$/)
  })

  it("enforces lobby rules", async () => {
    const { base } = await startGame()
    const { code, players } = await lobby(base, 4)
    expect((await call(base, `/api/rooms/${code}/join`, { body: { name: "Fifth" } })).body.code).toBe("ROOM_FULL")
    expect((await call(base, `/api/rooms/ZZZZZZ/join`, { body: { name: "X" } })).status).toBe(404)
    expect((await call(base, `/api/rooms/${code}/start`, { token: players[1].token, body: {} })).body.code).toBe("NOT_HOST")
    expect((await call(base, "/api/rooms", { body: { name: "  " } })).body.code).toBe("INVALID_NAME")
    expect((await call(base, "/api/rooms", { body: { name: "x".repeat(21) } })).body.code).toBe("INVALID_NAME")

    const solo = await call(base, "/api/rooms", { body: { name: "Solo" } })
    expect((await call(base, `/api/rooms/${solo.body.code}/start`, { token: solo.body.token as string, body: {} })).body.code).toBe("PLAYER_COUNT")
    expect((await call(base, `/api/rooms/${solo.body.code}/join`, { body: { name: "solo" } })).body.code).toBe("NAME_TAKEN")

    await call(base, `/api/rooms/${code}/start`, { token: players[0].token, body: {} })
    expect((await call(base, `/api/rooms/${code}/join`, { body: { name: "Late" } })).body.code).toBe("ROOM_STARTED")
    expect((await call(base, `/api/rooms/${code}/leave`, { token: players[1].token, body: {} })).body.code).toBe("ROOM_STARTED")
  })

  it("host leaving the lobby hands over hosting", async () => {
    const { base } = await startGame()
    const { code, players } = await lobby(base, 2)
    await call(base, `/api/rooms/${code}/leave`, { token: players[0].token, body: {} })
    const view = (await call(base, `/api/rooms/${code}`, { token: players[1].token })).body as unknown as RoomView
    expect(view.hostId).toBe(players[1].id)
    expect(view.players).toHaveLength(1)
  })

  it("never treats the room code as authorization", async () => {
    const { base } = await startGame()
    const { code, players } = await lobby(base, 2)
    const other = await lobby(base, 2)
    await call(base, `/api/rooms/${code}/start`, { token: players[0].token, body: {} })
    expect((await call(base, `/api/rooms/${code}`)).status).toBe(401)
    expect((await call(base, `/api/rooms/${code}`, { token: other.players[0].token })).status).toBe(401)
    expect((await call(base, `/api/rooms/${code}`, { token: "x".repeat(43) })).status).toBe(401)
    const preview = await call(base, `/api/rooms/${code}/preview`)
    expect(preview.body).toEqual({ code, name: "Trovekit Game Room", status: "playing", players: ["Host", "P1"], maxPlayers: 4, title: "Starfall Academy", icon: null })
    expect(JSON.stringify(preview.body)).not.toContain(players[0].id)
  })

  it("rejects out-of-turn, stale and replayed actions without changing state", async () => {
    const { base } = await startGame()
    const { code, players } = await lobby(base, 2)
    await call(base, `/api/rooms/${code}/start`, { token: players[0].token, body: {} })
    const view = (await call(base, `/api/rooms/${code}`, { token: players[0].token })).body as unknown as RoomView
    const game = view.game!
    const active = players.find((p) => p.id === game.players[game.active].id)!
    const idle = players.find((p) => p !== active)!
    const kinds = Object.keys(game.supply.resources).slice(0, 3)
    const action = { type: "collect", take: Object.fromEntries(kinds.map((k) => [k, 1])) }

    const outOfTurn = await call(base, `/api/rooms/${code}/actions`, { token: idle.token, body: { actionId: randomUUID(), expectedRevision: 0, action } })
    expect([outOfTurn.status, outOfTurn.body.code]).toEqual([422, "NOT_YOUR_TURN"])

    const stale = await call(base, `/api/rooms/${code}/actions`, { token: active.token, body: { actionId: randomUUID(), expectedRevision: 5, action } })
    expect([stale.status, stale.body.code]).toEqual([409, "STALE_REVISION"])

    const actionId = randomUUID()
    const first = await call(base, `/api/rooms/${code}/actions`, { token: active.token, body: { actionId, expectedRevision: 0, action } })
    expect(first.body).toMatchObject({ replayed: false, revision: 1 })
    const replay = await call(base, `/api/rooms/${code}/actions`, { token: active.token, body: { actionId, expectedRevision: 0, action } })
    expect(replay.body).toMatchObject({ replayed: true, revision: 1 })
    const hijack = await call(base, `/api/rooms/${code}/actions`, { token: idle.token, body: { actionId, expectedRevision: 1, action } })
    expect(hijack.body.code).toBe("DUPLICATE_ACTION")

    const after = (await call(base, `/api/rooms/${code}`, { token: idle.token })).body as unknown as RoomView
    expect(after.revision).toBe(1)
    expect(after.game!.players.find((p) => p.id === active.id)!.turns).toBe(1)

    const bad = await call(base, `/api/rooms/${code}/actions`, { token: idle.token, body: { actionId: randomUUID(), expectedRevision: 1, action: { type: "collect", take: { [kinds[0]]: 3 } } } })
    expect([bad.status, bad.body.code]).toEqual([422, "INVALID_COLLECT"])
    expect(((await call(base, `/api/rooms/${code}`, { token: idle.token })).body as unknown as RoomView).revision).toBe(1)
  })

  it("does not leak deck order, seed or session resources", async () => {
    const { base } = await startGame()
    const { code, players } = await lobby(base, 2)
    const view = await call(base, `/api/rooms/${code}/start`, { token: players[0].token, body: {} })
    const text = JSON.stringify(view.body)
    expect(text).not.toContain(players[0].token)
    expect(text).not.toContain("tokenHash")
    expect(text).not.toContain('"decks"')
    expect((view.body.game as Json).seed).toBeNull()
  })

  it("host can end a game; then actions are refused", async () => {
    const { base } = await startGame()
    const { code, players } = await lobby(base, 2)
    await call(base, `/api/rooms/${code}/start`, { token: players[0].token, body: {} })
    expect((await call(base, `/api/rooms/${code}/end`, { token: players[1].token, body: {} })).body.code).toBe("NOT_HOST")
    const ended = await call(base, `/api/rooms/${code}/end`, { token: players[0].token, body: {} })
    expect(ended.body.status).toBe("abandoned")
    const r = await call(base, `/api/rooms/${code}/actions`, { token: players[0].token, body: { actionId: randomUUID(), expectedRevision: 0, action: { type: "pass" } } })
    expect(r.body.code).toBe("ROOM_ENDED")
  })

  it("expires idle rooms with a clear error", async () => {
    let now = Date.now()
    const { base, rooms } = await startGame(undefined, { now: () => now })
    const { code, players } = await lobby(base, 2)
    now += 25 * 3600_000
    const r = await call(base, `/api/rooms/${code}`, { token: players[0].token })
    expect([r.status, r.body.code, r.body.message]).toEqual([404, "ROOM_NOT_FOUND", "This room does not exist or has expired"])
    expect(rooms.sweep()).toEqual([code])
  })

  it("enforces request size and JSON", async () => {
    const { base } = await startGame()
    expect((await call(base, "/api/rooms", { body: { name: "x".repeat(20000) } })).status).toBe(413)
    const res = await fetch(`${base}/api/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: "{nope" })
    expect(res.status).toBe(400)
  })
})

describe("persistence and reconnect", () => {
  it("unfinished games survive a server restart and continue", async () => {
    const first = await startGame()
    const { code, players } = await lobby(first.base, 3)
    await call(first.base, `/api/rooms/${code}/start`, { token: players[0].token, body: {} })
    const before = (await call(first.base, `/api/rooms/${code}`, { token: players[1].token })).body as unknown as RoomView
    first.server.closeAllConnections()
    first.server.close()

    const second = await startGame(first.dataDir)
    const after = (await call(second.base, `/api/rooms/${code}`, { token: players[1].token })).body as unknown as RoomView
    expect(after.game).toEqual(before.game)
    const end = await playToEnd(second.base, code, players)
    expect(end.status).toBe("finished")
  })
})

function connect(base: string, code: string, token: string) {
  const ws = new WebSocket(base.replace("http", "ws") + "/ws")
  const messages: Json[] = []
  const waiters: ((m: Json) => void)[] = []
  ws.on("message", (raw) => {
    const m = JSON.parse(String(raw)) as Json
    messages.push(m)
    waiters.splice(0).forEach((w) => w(m))
  })
  open.push({ close: () => ws.close() })
  const ready = new Promise<void>((r) => ws.on("open", () => (ws.send(JSON.stringify({ type: "hello", code, token })), r())))
  const next = (pred: (m: Json) => boolean) =>
    new Promise<Json>((resolve, reject) => {
      const found = messages.find(pred)
      if (found) return resolve(found)
      const t = setTimeout(() => reject(new Error("timeout waiting for message")), 3000)
      const check = (m: Json) => (pred(m) ? (clearTimeout(t), resolve(m)) : waiters.push(check))
      waiters.push(check)
    })
  return { ws, ready, next, messages }
}

describe("WebSocket sync", () => {
  it("pushes updates to every connected device and tracks presence", async () => {
    const { base } = await startGame()
    const { code, players } = await lobby(base, 2)
    const a = connect(base, code, players[0].token)
    const b = connect(base, code, players[1].token)
    await Promise.all([a.ready, b.ready])
    const both = (m: Json) => m.type === "room" && ((m.room as RoomView).players.every((p) => p.connected))
    await a.next(both)

    await call(base, `/api/rooms/${code}/start`, { token: players[0].token, body: {} })
    const started = (await b.next((m) => m.type === "room" && (m.room as RoomView).status === "playing")).room as RoomView
    const game = started.game!
    const active = players.find((p) => p.id === game.players[game.active].id)!
    const take = Object.fromEntries(Object.keys(game.supply.resources).slice(0, 3).map((k) => [k, 1]))
    await call(base, `/api/rooms/${code}/actions`, { token: active.token, body: { actionId: randomUUID(), expectedRevision: 0, action: { type: "collect", take } } })
    for (const c of [a, b]) await c.next((m) => m.type === "room" && (m.room as RoomView).revision === 1)

    // Same guest on a second device (reconnect) gets the current state.
    const again = connect(base, code, players[1].token)
    await again.ready
    b.ws.close()
    const seen = (await again.next((m) => m.type === "room" && (m.room as RoomView).revision === 1)).room as RoomView
    expect(seen.players.find((p) => p.id === players[1].id)!.connected).toBe(true)
  })

  it("refuses sockets without a valid session", async () => {
    const { base } = await startGame()
    const { code } = await lobby(base, 2)
    const c = connect(base, code, "not-a-real-token-at-all-xxxxxxxx")
    await c.ready
    const m = await c.next((m) => m.type === "error")
    expect(m.code).toBe("UNAUTHORIZED")
  })
})

describe("content snapshots and admin isolation", () => {
  it("live rooms keep their snapshot when the admin activates new content", async () => {
    const game = await startGame()
    const admin = createAdminServer({ dataDir: game.dataDir, port: 0 })
    await new Promise<void>((r) => admin.server.listen(0, "127.0.0.1", r))
    open.push({ close: () => admin.server.close() })
    const adminBase = `http://127.0.0.1:${(admin.server.address() as AddressInfo).port}`

    const live = await lobby(game.base, 2)
    await call(game.base, `/api/rooms/${live.code}/start`, { token: live.players[0].token, body: {} })
    const before = (await call(game.base, `/api/rooms/${live.code}/content`, { token: live.players[0].token })).body

    const content = starfallContent()
    content.rules.targetPoints = 20
    content.pack.cards[0].name = "Edited Name"
    // Admin host check uses the configured port; drive the store directly here, HTTP checks are covered below.
    const saved = admin.store.publish(content, "Target 20")
    expect(saved.ok && admin.store.activate(saved.version.id).ok).toBe(true)
    void adminBase

    const after = (await call(game.base, `/api/rooms/${live.code}/content`, { token: live.players[0].token })).body
    expect(after).toEqual(before)
    expect((after.rules as Rules).targetPoints).toBe(15)

    const fresh = await lobby(game.base, 2)
    const freshView = (await call(game.base, `/api/rooms/${fresh.code}/start`, { token: fresh.players[0].token, body: {} })).body as unknown as RoomView
    expect(freshView.content.targetPoints).toBe(20)
    expect(freshView.content.hash).not.toBe(before.hash)
  })

  it("the game server exposes no admin routes or page", async () => {
    const staticDir = mkdtempSync(join(tmpdir(), "trovekit-dist-"))
    writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>game</title>")
    writeFileSync(join(staticDir, "admin.html"), "<!doctype html><title>admin</title>")
    mkdirSync(join(staticDir, "assets"))
    const { base } = await startGame(undefined, { staticDir })
    for (const [method, path] of [["POST", "/admin-api/versions"], ["POST", "/admin-api/active"], ["GET", "/admin-api/content"]]) {
      const res = await fetch(base + path, { method, headers: { "x-trovekit-admin": "1", "content-type": "application/json" }, body: method === "POST" ? "{}" : undefined })
      expect(res.status).toBe(404)
    }
    expect((await fetch(`${base}/admin.html`)).status).toBe(404)
    expect(await (await fetch(`${base}/r/ABCDEF`)).text()).toContain("game")
    expect(await (await fetch(`${base}/../../etc/passwd`)).text()).toContain("game")
  })
})

describe("admin server", () => {
  async function startAdmin() {
    const dataDir = mkdtempSync(join(tmpdir(), "trovekit-admin-"))
    // Bind to a fixed free port so the Host check matches.
    const probe = createGameServer({ dataDir })
    await new Promise<void>((r) => probe.server.listen(0, "127.0.0.1", r))
    const port = (probe.server.address() as AddressInfo).port
    await new Promise<void>((r) => probe.server.close(() => r()))
    const admin = createAdminServer({ dataDir, port })
    await new Promise<void>((r) => admin.listen(r))
    open.push({ close: () => admin.server.close() })
    const base = `http://127.0.0.1:${port}`
    const req = (path: string, init: RequestInit = {}) =>
      fetch(base + path, { ...init, headers: { "x-trovekit-admin": "1", "content-type": "application/json", ...(init.headers ?? {}) } })
    return { admin, base, req, dataDir }
  }

  it("binds to loopback only", async () => {
    const { admin } = await startAdmin()
    expect((admin.server.address() as AddressInfo).address).toBe("127.0.0.1")
  })

  it("requires the admin header and a localhost Host", async () => {
    const { base, req } = await startAdmin()
    expect((await fetch(`${base}/admin-api/content`)).status).toBe(403)
    const port = new URL(base).port
    // fetch cannot override Host, so use a raw request to simulate DNS rebinding.
    const status = await new Promise<number>((resolve) =>
      request({ host: "127.0.0.1", port, path: "/admin-api/content", headers: { host: `evil.example:${port}`, "x-trovekit-admin": "1" } }, (res) => {
        res.resume()
        resolve(res.statusCode!)
      }).end()
    )
    expect(status).toBe(403)
    expect((await req("/admin-api/content")).status).toBe(200)
  })

  it("starts with an empty library, then validates, saves and switches versions", async () => {
    const { req, admin } = await startAdmin()
    expect(await (await req("/admin-api/content")).json()).toEqual({ active: null, activeHash: null, versions: [] })
    expect(await (await req("/admin-api/packs")).json()).toEqual([])
    expect(admin.store.active()).toBeNull()
    const content = starfallContent()
    const invalid = structuredClone(content)
    invalid.pack.relationships[0].cardIds[0] = "ghost"
    const v = await (await req("/admin-api/validate", { method: "POST", body: JSON.stringify(invalid) })).json()
    expect(v.ok).toBe(false)
    expect(v.issues[0]).toMatchObject({ path: "pack.relationships.0.cardIds.0", message: 'Unknown card "ghost"' })

    const rejected = await req("/admin-api/versions", { method: "POST", body: JSON.stringify({ content: invalid, note: "bad" }) })
    expect(rejected.status).toBe(422)

    content.rules.targetPoints = 18
    const saved = await (await req("/admin-api/versions", { method: "POST", body: JSON.stringify({ content, note: "Longer games" }) })).json()
    expect(saved.ok).toBe(true)
    // Publishing never chooses the default; Make default is its own step.
    expect((await (await req("/admin-api/content")).json()).active).toBeNull()
    expect((await req("/admin-api/active", { method: "POST", body: JSON.stringify({ id: saved.version.id }) })).status).toBe(200)
    let list = await (await req("/admin-api/content")).json()
    expect(list.active).toBe(saved.version.id)
    expect(list.versions.map((x: { id: string }) => x.id)).toEqual([saved.version.id])
    expect(admin.store.active()?.content.rules.targetPoints).toBe(18)

    content.rules.targetPoints = 15
    const second = await (await req("/admin-api/versions", { method: "POST", body: JSON.stringify({ content, note: "Shorter" }) })).json()
    expect(admin.store.active()?.id).toBe(saved.version.id)
    expect((await req("/admin-api/active", { method: "POST", body: JSON.stringify({ id: second.version.id }) })).status).toBe(200)
    list = await (await req("/admin-api/content")).json()
    expect(list.active).toBe(second.version.id)
    expect(admin.store.active()?.content.rules.targetPoints).toBe(15)
    // There is no built-in version to fall back to.
    expect((await req("/admin-api/active", { method: "POST", body: JSON.stringify({ id: "default" }) })).status).toBe(404)
    expect((await req(`/admin-api/versions/${saved.version.id}`)).status).toBe(200)
    expect((await req("/admin-api/active", { method: "POST", body: JSON.stringify({ id: "../../etc" }) })).status).toBe(404)
  })

  it("limits import size and reports bad JSON clearly", async () => {
    const { req } = await startAdmin()
    const big = await req("/admin-api/validate", { method: "POST", body: JSON.stringify({ pack: "x".repeat(1100 * 1024) }) })
    expect(big.status).toBe(413)
    const broken = await req("/admin-api/validate", { method: "POST", body: "{not json" })
    expect(await broken.json()).toMatchObject({ code: "INVALID_JSON" })
  })
})
