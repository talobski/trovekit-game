import { randomUUID } from "node:crypto"
import { mkdtempSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { chooseNormalAction, playBotGame } from "../src/bots"
import { createContext, setupGame, type GameState } from "../src/engine"
import { contentIssues, packImages, type Content } from "../src/shared/content"
import { createAdminServer } from "../server/admin-server"
import { createGameServer } from "../server/game-server"
import type { RoomView } from "../server/rooms"
import { starfallBundle, starfallContent } from "./fixtures/starfall"

/*
 * A non-basketball pack end to end: its own archetypes, cards, artwork,
 * relationships and achievements, imported as a ZIP through the private admin,
 * published, chosen for a room on the game server and played to a winner.
 * No engine, server or client code knows about this theme.
 */

describe("Starfall Academy content", () => {
  it("is a complete, valid pack with its own vocabulary", () => {
    const { pack, rules } = starfallContent()
    expect(contentIssues({ pack, rules })).toEqual([])
    expect(pack.resourceKinds.map((k) => k.label)).toEqual(["Ember", "Tide", "Gale", "Stone", "Spark"])
    expect(pack.cards).toHaveLength(66)
    expect(new Set(pack.cards.map((c) => c.name)).size).toBe(66)
    expect(pack.relationships.map((r) => r.cardIds.length)).toEqual([2, 2, 2, 2, 2, 2, 3, 3, 3])
    expect(pack.achievements).toHaveLength(12)
    expect(new Set(pack.achievements.map((a) => a.category))).toEqual(new Set(["lore", "mastery", "triumph", "renown"]))
    const text = JSON.stringify(pack).toLowerCase()
    for (const word of ["basketball", "superstar", "prospect", "highflyer", "shooter", "rebounder", "tier1"]) expect(text).not.toContain(word)
  })

  it.each([2, 3, 4])("%i bots finish games on it", (n) => {
    const { pack, rules } = starfallContent()
    const ctx = createContext(pack, rules)
    const players = ["a", "b", "c", "d"].slice(0, n).map((id) => ({ id, name: id }))
    for (let g = 0; g < 10; g++) {
      const end = playBotGame(ctx, setupGame(ctx, players, `starfall-${n}-${g}`), `starfall-bots-${n}-${g}`)
      expect(end.status).toBe("finished")
      expect(end.result!.winners.length).toBeGreaterThan(0)
    }
  })
})

describe("Starfall Academy through the real servers", () => {
  let bundle: Awaited<ReturnType<typeof starfallBundle>>
  let admin: string
  let game: string
  const closers: (() => void)[] = []
  const ADMIN = { "x-trovekit-admin": "1" }

  beforeAll(async () => {
    bundle = await starfallBundle()
    const dataDir = mkdtempSync(join(tmpdir(), "trovekit-starfall-"))
    const probe = createGameServer({ dataDir: mkdtempSync(join(tmpdir(), "trovekit-probe-")) })
    await new Promise<void>((r) => probe.server.listen(0, "127.0.0.1", r))
    const port = (probe.server.address() as AddressInfo).port
    await new Promise<void>((r) => probe.server.close(() => r()))
    const a = createAdminServer({ dataDir, port })
    await new Promise<void>((r) => a.listen(r))
    admin = `http://127.0.0.1:${port}`
    const g = createGameServer({ dataDir, botDelayMs: 0 })
    await new Promise<void>((r) => g.server.listen(0, "127.0.0.1", r))
    game = `http://127.0.0.1:${(g.server.address() as AddressInfo).port}`
    closers.push(() => a.server.close(), () => (g.server.closeAllConnections(), g.server.close()))
  }, 120_000)
  afterAll(() => closers.forEach((c) => c()))

  it("imports as a ZIP, publishes, is made the default for a room, and plays to a winner with its artwork served", async () => {
    // Import: the admin decodes and verifies every image and returns the content for review.
    const imported = await fetch(`${admin}/admin-api/bundle-import`, { method: "POST", headers: { ...ADMIN, "content-type": "application/zip" }, body: new Blob([new Uint8Array(bundle.zip)]) })
    expect(imported.status).toBe(200)
    const content = (await imported.json()) as Content
    expect(content).toEqual(bundle.content)
    expect(packImages(content.pack)).toHaveLength(67) // 66 cards and the Motes crest

    // Publishing alone offers nothing to players; Make default opens it to new rooms.
    const saved = await fetch(`${admin}/admin-api/versions`, { method: "POST", headers: { ...ADMIN, "content-type": "application/json" }, body: JSON.stringify({ content, note: "Starfall" }) })
    expect(saved.status).toBe(201)
    expect(await (await fetch(`${game}/api/packs`)).json()).toEqual([])
    const { version } = await saved.json()
    expect((await fetch(`${admin}/admin-api/active`, { method: "POST", headers: { ...ADMIN, "content-type": "application/json" }, body: JSON.stringify({ id: version.id }) })).status).toBe(200)
    expect(await (await fetch(`${game}/api/packs`)).json()).toEqual([{ id: "active", name: "Starfall Academy", packId: "starfall", default: true, title: "Starfall Academy", icon: null, description: "An original example pack: students of five elements at a fictional academy." }])

    // A room on Starfall: one human and three bots.
    const host = await (await fetch(`${game}/api/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Host", roomName: "Academy night" }) })).json()
    const auth = { authorization: `Bearer ${host.token}`, "content-type": "application/json" }
    for (let i = 0; i < 3; i++) expect((await fetch(`${game}/api/rooms/${host.code}/add-bot`, { method: "POST", headers: auth, body: "{}" })).status).toBe(201)
    expect((await fetch(`${game}/api/rooms/${host.code}/start`, { method: "POST", headers: auth, body: "{}" })).status).toBe(200)
    const roomContent = (await (await fetch(`${game}/api/rooms/${host.code}/content`, { headers: auth })).json()) as Content
    expect(roomContent.pack.id).toBe("starfall")
    expect(roomContent.pack.labels.acquire).toBe("Bond")

    // Every image the room uses is served by the game server and decodes as the prepared portrait.
    for (const { src } of packImages(roomContent.pack).slice(0, 8)) {
      const res = await fetch(game + src)
      expect(res.status).toBe(200)
      const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata()
      expect([meta.width, meta.height]).toEqual([480, 600])
    }

    // Play: the human uses the Normal strategy on its public view; bots move on the server.
    const ctx = createContext(roomContent.pack, roomContent.rules)
    let room: RoomView | null = null
    for (let guard = 0; guard < 4000; guard++) {
      room = (await (await fetch(`${game}/api/rooms/${host.code}`, { headers: auth })).json()) as RoomView
      if (room.status !== "playing") break
      const g = room.game!
      if (g.players[g.active].id !== host.playerId) {
        await new Promise((r) => setTimeout(r, 2))
        continue
      }
      const action = chooseNormalAction(ctx, g as unknown as GameState, `human:${g.revision}`)
      const res = await fetch(`${game}/api/rooms/${host.code}/actions`, { method: "POST", headers: auth, body: JSON.stringify({ actionId: randomUUID(), expectedRevision: g.revision, action }) })
      expect(res.status).toBe(200)
    }
    expect(room!.status).toBe("finished")
    expect(room!.game!.result!.winners.length).toBeGreaterThan(0)
    expect(new Set(room!.game!.players.map((p) => p.turns)).size).toBe(1)
    // Its own achievements were in play.
    const honors = new Set(roomContent.pack.achievements.map((a) => a.id))
    expect(room!.game!.achievements.every((id) => honors.has(id))).toBe(true)
  }, 120_000)
})
