import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import WebSocket from "ws"
import { ContentStore } from "../server/content-store"
import { exportBundle, importBundle } from "../server/bundles"
import { createGameServer } from "../server/game-server"
import { RoomError, RoomService, type RoomView } from "../server/rooms"
import type { Content } from "../src/shared/content"
import { starfallContent } from "./fixtures/starfall"

/*
 * A room plays exactly the version that was the default when the room
 * was created, through waiting, joining, adding bots, starting, server restarts
 * and reconnects. A waiting room saved before pinning never silently picks up
 * whatever is the default today.
 */

const closers: (() => void)[] = []
afterEach(() => closers.splice(0).reverse().forEach((c) => c()))

/** v1: up to 4 players, first to 15. v2: exactly 2 players, first to 12. */
function library() {
  const dir = mkdtempSync(join(tmpdir(), "trovekit-pinning-"))
  const store = new ContentStore(dir)
  const publish = (content: Content) => {
    const r = store.publish(content, "v")
    if (!r.ok) throw new Error(JSON.stringify(r))
    return r.version.id
  }
  const v1 = publish(starfallContent())
  const second = starfallContent()
  second.rules.targetPoints = 12
  second.rules.playerCounts = { min: 2, max: 2 }
  const v2 = publish(second)
  store.activate(v1)
  return { dir, store, v1, v2 }
}

const service = (dir: string, store = new ContentStore(dir)) => {
  const rooms = new RoomService(dir, store, { botDelayMs: 60_000 })
  closers.push(() => rooms.dispose())
  return rooms
}

const code = (fn: () => unknown) => {
  try { fn() } catch (e) { return e instanceof RoomError ? e.code : String(e) }
  return "OK"
}

describe("pinned at creation", () => {
  it("joins, bots, player limits and start all follow the pinned version after the default changes", () => {
    const { dir, store, v1, v2 } = library()
    const rooms = service(dir, store)
    const host = rooms.create("Host", "Pinned")
    expect(rooms.getRoom(host.code)?.selectedVersion).toBe(v1)
    store.activate(v2)
    // v2 allows only 2 players; the room keeps v1's limit of 4.
    rooms.join(host.code, "Guest")
    rooms.addBot(host.code, host.token)
    expect(rooms.view(host.code, host.token)).toMatchObject({ maxPlayers: 4, content: { targetPoints: 15 }, problem: null })
    rooms.start(host.code, host.token)
    const room = rooms.getRoom(host.code)!
    expect(room.snapshot?.versionId).toBe(v1)
    expect(room.snapshot?.content.rules.targetPoints).toBe(15)
    // A new room uses the new default.
    const next = rooms.create("Other host")
    expect(rooms.getRoom(next.code)?.selectedVersion).toBe(v2)
  })

  it("survives a server restart and recovery, then starts on the pinned version", () => {
    const { dir, store, v1, v2 } = library()
    const host = service(dir, store).create("Host")
    store.activate(v2)
    const restarted = service(dir)
    expect(restarted.getRoom(host.code)?.selectedVersion).toBe(v1)
    expect(restarted.view(host.code, host.token).content.targetPoints).toBe(15)
    restarted.join(host.code, "Guest")
    restarted.start(host.code, host.token)
    expect(service(dir).getRoom(host.code)?.snapshot?.versionId).toBe(v1)
  })

  it("keeps working when its pack is archived, because archiving only affects future availability", () => {
    const { dir, store } = library()
    const rooms = service(dir, store)
    const host = rooms.create("Host")
    const other = starfallContent()
    other.pack.id = "nebula"
    const nebula = store.publish(other, "n")
    if (!nebula.ok) throw new Error("publish failed")
    store.activate(nebula.version.id)
    expect(store.archive("starfall", true)).toBe(true)
    expect(code(() => rooms.join(host.code, "Guest"))).toBe("OK")
    expect(code(() => rooms.start(host.code, host.token))).toBe("OK")
  })

  it("a started room keeps its snapshot and recovery rejects a snapshot that contradicts the pin", () => {
    const { dir, store, v2 } = library()
    const rooms = service(dir, store)
    const host = rooms.create("Host")
    rooms.join(host.code, "Guest")
    rooms.start(host.code, host.token)
    const file = join(dir, "rooms", `${host.code}.json`)
    const saved = JSON.parse(readFileSync(file, "utf8"))
    writeFileSync(file, JSON.stringify({ ...saved, selectedVersion: v2 }))
    expect(service(dir).getRoom(host.code)).toBeUndefined()
  })
})

describe("waiting rooms that cannot be used fail safely", () => {
  function legacyLobby(dir: string, store: ContentStore) {
    const rooms = service(dir, store)
    const host = rooms.create("Host")
    rooms.dispose()
    const file = join(dir, "rooms", `${host.code}.json`)
    const saved = JSON.parse(readFileSync(file, "utf8"))
    delete saved.selectedVersion
    writeFileSync(file, JSON.stringify(saved))
    return host
  }

  it("an unpinned waiting room explains itself instead of rebinding to the current default", () => {
    const { dir, store } = library()
    const host = legacyLobby(dir, store)
    const rooms = service(dir, store)
    const view = rooms.view(host.code, host.token)
    expect(view.problem).toMatchObject({ code: "ROOM_UNPINNED", message: expect.stringContaining("create a new room") })
    expect(view.content).toEqual({ hash: "", name: "", version: "", targetPoints: 0, title: "", icon: null })
    expect(rooms.viewOf(rooms.getRoom(host.code)!)).toMatchObject({ problem: { code: "ROOM_UNPINNED" } })
    expect(rooms.preview(host.code)).toMatchObject({ status: "lobby", players: ["Host"] })
    expect(code(() => rooms.join(host.code, "Guest"))).toBe("ROOM_UNPINNED")
    expect(code(() => rooms.addBot(host.code, host.token))).toBe("ROOM_UNPINNED")
    expect(code(() => rooms.start(host.code, host.token))).toBe("ROOM_UNPINNED")
    expect(() => rooms.content(host.code, host.token)).toThrow(RoomError)
    expect(rooms.getRoom(host.code)?.selectedVersion).toBeUndefined()
    expect(code(() => rooms.leave(host.code, host.token))).toBe("OK")
  })

  it("an unpinned room that already started is unchanged and playable", () => {
    const { dir, store, v1 } = library()
    const rooms = service(dir, store)
    const host = rooms.create("Host")
    rooms.join(host.code, "Guest")
    rooms.start(host.code, host.token)
    rooms.dispose()
    const file = join(dir, "rooms", `${host.code}.json`)
    const saved = JSON.parse(readFileSync(file, "utf8"))
    delete saved.selectedVersion
    writeFileSync(file, JSON.stringify(saved))
    const restarted = service(dir)
    expect(restarted.view(host.code, host.token)).toMatchObject({ status: "playing", problem: null, content: { targetPoints: 15 } })
    expect(restarted.getRoom(host.code)?.snapshot?.versionId).toBe(v1)
  })

  it("a waiting room whose version file is gone reports PACK_UNAVAILABLE", () => {
    const { dir, store, v1 } = library()
    const host = service(dir, store).create("Host")
    writeFileSync(join(dir, "content", "versions", `${v1}.json`), "{}")
    const rooms = service(dir)
    expect(rooms.view(host.code, host.token).problem?.code).toBe("PACK_UNAVAILABLE")
    expect(code(() => rooms.start(host.code, host.token))).toBe("PACK_UNAVAILABLE")
  })
})

describe("reconnecting to a pinned lobby", () => {
  it("HTTP and WebSocket views after a default change and a restart still show the pinned version", async () => {
    const { dir, store, v2 } = library()
    const start = async () => {
      const g = createGameServer({ dataDir: dir, botDelayMs: 60_000 })
      await new Promise<void>((r) => g.server.listen(0, "127.0.0.1", r))
      closers.push(() => { g.server.closeAllConnections(); g.server.close() })
      return `http://127.0.0.1:${(g.server.address() as AddressInfo).port}`
    }
    let base = await start()
    const host = await (await fetch(`${base}/api/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Host" }) })).json()
    const first = await (await fetch(`${base}/api/rooms/${host.code}`, { headers: { authorization: `Bearer ${host.token}` } })).json() as RoomView
    store.activate(v2)
    base = await start() // a second process on the same data, as after a restart
    const view = await (await fetch(`${base}/api/rooms/${host.code}`, { headers: { authorization: `Bearer ${host.token}` } })).json() as RoomView
    expect(view.content).toEqual(first.content)
    const ws = new WebSocket(base.replace("http", "ws") + "/ws")
    closers.push(() => ws.close())
    const pushed = await new Promise<RoomView>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no room message")), 3000)
      ws.on("open", () => ws.send(JSON.stringify({ type: "hello", code: host.code, token: host.token })))
      ws.on("message", (raw) => {
        const m = JSON.parse(String(raw))
        if (m.type === "room") { clearTimeout(timer); resolve(m.room) }
      })
    })
    expect(pushed).toMatchObject({ content: first.content, maxPlayers: 4, problem: null })
  })
})

describe("version integrity (published versions are verified before use)", () => {
  const versionPath = (dir: string, id: string) => join(dir, "content", "versions", `${id}.json`)
  /** Ways a version file can go wrong on disk. Each leaves the version unusable, never crashing anything. */
  const damage: Record<string, (dir: string, id: string) => void> = {
    altered: (dir, id) => {
      const content = JSON.parse(readFileSync(versionPath(dir, id), "utf8"))
      content.rules.targetPoints = 99 // still valid content, but not what was published
      writeFileSync(versionPath(dir, id), JSON.stringify(content))
    },
    malformed: (dir, id) => writeFileSync(versionPath(dir, id), "{ not json"),
    unreadable: (dir, id) => { rmSync(versionPath(dir, id)); mkdirSync(versionPath(dir, id)) },
    missing: (dir, id) => rmSync(versionPath(dir, id)),
  }

  for (const [kind, harm] of Object.entries(damage))
    it(`a ${kind} version is unavailable to the store, the admin and its pinned rooms`, async () => {
      const { dir, store, v1 } = library()
      const rooms = service(dir, store)
      const host = rooms.create("Host")
      const guest = rooms.join(host.code, "Guest")
      harm(dir, v1)
      expect(store.get(v1)).toBeNull()
      expect(store.version(v1)).toBeNull()
      expect(store.active()).toBeNull()
      expect(store.healthy).toBe(false)
      expect(store.activate(v1)).toEqual({ ok: false, code: "NOT_FOUND" })
      expect(() => store.list()).not.toThrow()
      expect(store.catalog().map((p) => p.id)).toEqual(["starfall"])
      // The waiting room explains itself instead of crashing views, joins or the start.
      const view = rooms.view(host.code, host.token)
      expect(view.problem).toMatchObject({ code: "PACK_UNAVAILABLE" })
      expect(rooms.viewOf(rooms.getRoom(host.code)!).problem?.code).toBe("PACK_UNAVAILABLE")
      expect(() => rooms.preview(host.code)).not.toThrow()
      expect(code(() => rooms.join(host.code, "Third"))).toBe("PACK_UNAVAILABLE")
      expect(code(() => rooms.start(host.code, host.token))).toBe("PACK_UNAVAILABLE")
      expect(code(() => rooms.content(host.code, guest.token))).toBe("PACK_UNAVAILABLE")
      expect(rooms.getRoom(host.code)?.snapshot).toBeNull()
      // No new room can be created on it either.
      expect(code(() => rooms.create("Other"))).toBe("NO_CONTENT")
    })

  it("an orphaned version file (not in the index) can never be used", () => {
    const { dir, store, v1 } = library()
    writeFileSync(versionPath(dir, "v9-orphan1"), readFileSync(versionPath(dir, v1)))
    expect(store.get("v9-orphan1")).toBeNull()
    expect(store.version("v9-orphan1")).toBeNull()
    expect(store.activate("v9-orphan1")).toEqual({ ok: false, code: "NOT_FOUND" })
    expect(store.list().versions.map((v) => v.id)).not.toContain("v9-orphan1")
    // A room saved as pinned to it (for example a hand-edited file) is unavailable.
    const host = service(dir, store).create("Host")
    const file = join(dir, "rooms", `${host.code}.json`)
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), selectedVersion: "v9-orphan1" }))
    expect(service(dir).view(host.code, host.token).problem?.code).toBe("PACK_UNAVAILABLE")
  })

  it("an unreadable index while a lobby is open gives PACK_UNAVAILABLE, not an error", () => {
    const { dir, store } = library()
    const rooms = service(dir, store)
    const host = rooms.create("Host")
    const index = join(dir, "content", "index.json")
    const saved = readFileSync(index)
    writeFileSync(index, "{ broken")
    try {
      expect(rooms.view(host.code, host.token).problem?.code).toBe("PACK_UNAVAILABLE")
      expect(code(() => rooms.start(host.code, host.token))).toBe("PACK_UNAVAILABLE")
    } finally { writeFileSync(index, saved) }
    expect(rooms.view(host.code, host.token).problem).toBeNull()
  })

  it("valid versions stay usable: a pinned room starts with exactly the published content", () => {
    const { dir, store, v1 } = library()
    const rooms = service(dir, store)
    const host = rooms.create("Host")
    rooms.join(host.code, "Guest")
    rooms.start(host.code, host.token)
    const recorded = store.list().versions.find((v) => v.id === v1)!
    expect(rooms.getRoom(host.code)!.snapshot).toMatchObject({ versionId: v1, hash: recorded.hash })
  })

  it("over HTTP and WebSocket, a damaged pinned version is reported, never a server error or a closed socket", async () => {
    const { dir, v1 } = library()
    const g = createGameServer({ dataDir: dir, botDelayMs: 60_000 })
    await new Promise<void>((r) => g.server.listen(0, "127.0.0.1", r))
    closers.push(() => { g.server.closeAllConnections(); g.server.close() })
    const base = `http://127.0.0.1:${(g.server.address() as AddressInfo).port}`
    const post = (path: string, body: unknown, token?: string) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
    const host = await (await post("/api/rooms", { name: "Host" })).json()
    const early = await (await post(`/api/rooms/${host.code}/join`, { name: "Early guest" })).json()
    damage.malformed(dir, v1)
    const view = await fetch(`${base}/api/rooms/${host.code}`, { headers: { authorization: `Bearer ${host.token}` } })
    expect(view.status).toBe(200)
    expect((await view.json()).problem.code).toBe("PACK_UNAVAILABLE")
    expect((await fetch(`${base}/api/rooms/${host.code}/preview`)).status).toBe(200)
    const join = await post(`/api/rooms/${host.code}/join`, { name: "Late guest" })
    expect([join.status, (await join.json()).code]).toEqual([409, "PACK_UNAVAILABLE"])
    const start = await post(`/api/rooms/${host.code}/start`, {}, host.token)
    expect([start.status, (await start.json()).code]).toEqual([409, "PACK_UNAVAILABLE"])
    const ws = new WebSocket(base.replace("http", "ws") + "/ws")
    closers.push(() => ws.close())
    let closed = false
    ws.on("close", () => { closed = true })
    const pushed = await new Promise<RoomView>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no room message")), 3000)
      ws.on("open", () => ws.send(JSON.stringify({ type: "hello", code: host.code, token: host.token })))
      ws.on("message", (raw) => { const m = JSON.parse(String(raw)); if (m.type === "room") { clearTimeout(timer); resolve(m.room) } })
    })
    expect(pushed.problem?.code).toBe("PACK_UNAVAILABLE")
    // A change in the room is still broadcast to the host, not answered by closing the socket.
    const update = new Promise<RoomView>((resolve) => ws.on("message", (raw) => { const m = JSON.parse(String(raw)); if (m.type === "room" && m.room.players.length === 1) resolve(m.room) }))
    expect((await post(`/api/rooms/${host.code}/leave`, {}, early.token)).status).toBe(200)
    expect((await update).problem?.code).toBe("PACK_UNAVAILABLE")
    expect(closed).toBe(false)
  })
})

describe("the game's title and icon", () => {
  /** v1: Starfall's own title and the star icon. v2: another title, the moon icon. v3: no icon. */
  function branded() {
    const dir = mkdtempSync(join(tmpdir(), "trovekit-brand-"))
    const store = new ContentStore(dir)
    const publish = (title: string, icon?: "star" | "moon") => {
      const content = starfallContent()
      content.pack.labels.game = title
      if (icon) content.pack.icon = icon
      const r = store.publish(content, title)
      if (!r.ok) throw new Error(JSON.stringify(r))
      return r.version.id
    }
    const v1 = publish("Starfall Academy", "star")
    const v2 = publish("Moonfall", "moon")
    const v3 = publish("Plainfall")
    store.activate(v1)
    return { dir, store, v1, v2, v3 }
  }
  const serve = async (dir: string) => {
    const g = createGameServer({ dataDir: dir, botDelayMs: 60_000 })
    await new Promise<void>((r) => g.server.listen(0, "127.0.0.1", r))
    closers.push(() => { g.server.closeAllConnections(); g.server.close() })
    return `http://127.0.0.1:${(g.server.address() as AddressInfo).port}`
  }

  it("the home page gets the default pack's title and icon; a pack without an icon gets none", async () => {
    const { dir, store, v3 } = branded()
    const base = await serve(dir)
    expect(await (await fetch(`${base}/api/packs`)).json()).toEqual([expect.objectContaining({ title: "Starfall Academy", icon: "star", default: true })])
    store.activate(v3)
    expect(await (await fetch(`${base}/api/packs`)).json()).toEqual([expect.objectContaining({ title: "Plainfall", icon: null })])
  })

  it("the home page gets the default pack's published description, or none when it has none", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trovekit-description-"))
    const store = new ContentStore(dir)
    const described = starfallContent()
    described.pack.description = `Fire & "water": a tale of five elements.`
    const plain = starfallContent()
    delete plain.pack.description
    const [a, b] = [described, plain].map((c) => {
      const r = store.publish(c, "v")
      if (!r.ok) throw new Error(JSON.stringify(r))
      return r.version.id
    })
    store.activate(a)
    const base = await serve(dir)
    // Sent exactly as written (the schema already refuses < and >); the page renders it as text.
    expect(await (await fetch(`${base}/api/packs`)).json()).toEqual([expect.objectContaining({ description: `Fire & "water": a tale of five elements.` })])
    store.activate(b)
    expect(await (await fetch(`${base}/api/packs`)).json()).toEqual([expect.objectContaining({ description: null })])
  })

  it("the added icons (wheat, beef, rectangle-circle, car, carrot) are valid for the pack and resource kinds, and survive export and import", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trovekit-icons-"))
    const store = new ContentStore(dir)
    const added = ["wheat", "beef", "rectangle-circle", "car", "carrot"] as const
    const content = starfallContent()
    content.pack.icon = "rectangle-circle"
    content.pack.resourceKinds.forEach((k, i) => (k.icon = added[i]))
    const r = store.publish(content, "new icons")
    if (!r.ok) throw new Error(JSON.stringify(r))
    const imported = await importBundle(mkdtempSync(join(tmpdir(), "trovekit-icons-import-")), Buffer.from(exportBundle(dir, store.version(r.version.id)!.content)))
    expect(imported.pack.icon).toBe("rectangle-circle")
    expect(imported.pack.resourceKinds.map((k) => k.icon)).toEqual([...added])
  })

  it("a room keeps its own pinned title and icon after the default changes, through start; new rooms use the new default", async () => {
    const { dir, store, v2 } = branded()
    const base = await serve(dir)
    const post = (path: string, body: unknown, token?: string) =>
      fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json())
    const view = (code: string, token: string) => fetch(`${base}/api/rooms/${code}`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json() as Promise<RoomView>)
    const host = await post("/api/rooms", { name: "Host" })
    expect((await view(host.code, host.token)).content).toMatchObject({ title: "Starfall Academy", icon: "star" })
    store.activate(v2)
    // Lobby, join preview and the started game all keep the room's own pack.
    expect((await view(host.code, host.token)).content).toMatchObject({ title: "Starfall Academy", icon: "star" })
    expect(await (await fetch(`${base}/api/rooms/${host.code}/preview`)).json()).toMatchObject({ title: "Starfall Academy", icon: "star" })
    await post(`/api/rooms/${host.code}/add-bot`, {}, host.token)
    await post(`/api/rooms/${host.code}/start`, {}, host.token)
    const started = await view(host.code, host.token)
    expect(started.status).toBe("playing")
    expect(started.content).toMatchObject({ title: "Starfall Academy", icon: "star" })
    // A new room uses the new default.
    const next = await post("/api/rooms", { name: "Next" })
    expect((await view(next.code, next.token)).content).toMatchObject({ title: "Moonfall", icon: "moon" })
  })

  it("the icon is optional, must come from the resource icon set, and survives publishing unchanged", () => {
    const { store, v1 } = branded()
    expect(store.version(v1)?.content.pack.icon).toBe("star")
    const bad = starfallContent() as unknown as { pack: { icon: string } }
    bad.pack.icon = "not-an-icon"
    expect(store.publish(bad as unknown as Content, "bad").ok).toBe(false)
    const none = starfallContent()
    expect(none.pack.icon).toBeUndefined()
    expect(store.publish(none, "older pack without an icon").ok).toBe(true)
  })

  it("export and import carry the icon unchanged", async () => {
    const { dir, store, v1 } = branded()
    const zip = exportBundle(dir, store.version(v1)!.content)
    const imported = await importBundle(mkdtempSync(join(tmpdir(), "trovekit-brand-import-")), Buffer.from(zip))
    expect(imported.pack.icon).toBe("star")
    expect(imported.pack.labels.game).toBe("Starfall Academy")
  })
})
