import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import { afterEach, describe, expect, it } from "vitest"
import { chooseNormalAction } from "../src/bots"
import { createContext, type GameState, type LogEntry, type Pack, type Rules } from "../src/engine"
import { createGameServer, type GameServerOptions } from "../server/game-server"
import type { RoomView } from "../server/rooms"
import { fixtureDataDir } from "./fixtures"

const open: { close: () => void }[] = []
afterEach(() => {
  while (open.length) open.pop()!.close()
})

async function start(options: Partial<GameServerOptions> = {}, dataDir = fixtureDataDir("trovekit-bots-")) {
  const g = createGameServer({ dataDir, botDelayMs: 0, ...options })
  await new Promise<void>((r) => g.server.listen(0, "127.0.0.1", r))
  const base = `http://127.0.0.1:${(g.server.address() as AddressInfo).port}`
  const close = () => {
    g.server.closeAllConnections()
    g.server.close()
  }
  open.push({ close })
  return { ...g, base, dataDir, close }
}

type Json = Record<string, unknown>
async function call(base: string, path: string, init: { token?: string; body?: unknown } = {}) {
  const res = await fetch(base + path, {
    method: init.body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
  return { status: res.status, body: (await res.json()) as Json }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function roomWithBots(base: string, bots: number, humans = 1) {
  const host = await call(base, "/api/rooms", { body: { name: "Host" } })
  const code = host.body.code as string
  const people = [{ id: host.body.playerId as string, token: host.body.token as string }]
  for (let i = 1; i < humans; i++) {
    const j = await call(base, `/api/rooms/${code}/join`, { body: { name: `Friend ${i}` } })
    people.push({ id: j.body.playerId as string, token: j.body.token as string })
  }
  for (let i = 0; i < bots; i++) expect((await call(base, `/api/rooms/${code}/add-bot`, { token: people[0].token, body: {} })).status).toBe(201)
  return { code, people }
}

const view = async (base: string, code: string, token: string) => (await call(base, `/api/rooms/${code}`, { token })).body as unknown as RoomView

/** Humans play with the Normal strategy on their public view; bots move on their own. */
async function playOut(base: string, code: string, people: { id: string; token: string }[]) {
  const content = (await call(base, `/api/rooms/${code}/content`, { token: people[0].token })).body as unknown as { pack: Pack; rules: Rules }
  const ctx = createContext(content.pack, content.rules)
  for (let guard = 0; guard < 4000; guard++) {
    const room = await view(base, code, people[0].token)
    if (room.status !== "playing") return room
    const game = room.game!
    const human = people.find((p) => p.id === game.players[game.active].id)
    if (!human) {
      await sleep(2)
      continue
    }
    const action = chooseNormalAction(ctx, game as unknown as GameState, `human:${game.revision}`)
    const r = await call(base, `/api/rooms/${code}/actions`, { token: human.token, body: { actionId: randomUUID(), expectedRevision: game.revision, action } })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
  }
  throw new Error("game did not finish")
}

const byPlayer = (log: LogEntry[], id: string) => log.filter((e) => "player" in e && e.player === id)

describe("bots in the lobby", () => {
  it("only the host adds and removes bots, within the player limit, before the start", async () => {
    const { base } = await start()
    const { code, people } = await roomWithBots(base, 0, 2)
    expect((await call(base, `/api/rooms/${code}/add-bot`, { token: people[1].token, body: {} })).body.code).toBe("NOT_HOST")
    const one = (await call(base, `/api/rooms/${code}/add-bot`, { token: people[0].token, body: {} })).body as unknown as RoomView
    const bot = one.players.find((p) => p.bot)!
    expect(bot).toMatchObject({ name: "Bot 1", bot: "normal", connected: true })
    await call(base, `/api/rooms/${code}/add-bot`, { token: people[0].token, body: {} })
    expect((await call(base, `/api/rooms/${code}/add-bot`, { token: people[0].token, body: {} })).body.code).toBe("ROOM_FULL")
    expect((await call(base, `/api/rooms/${code}/join`, { body: { name: "Late" } })).body.code).toBe("ROOM_FULL")

    expect((await call(base, `/api/rooms/${code}/remove-bot`, { token: people[1].token, body: { playerId: bot.id } })).body.code).toBe("NOT_HOST")
    expect((await call(base, `/api/rooms/${code}/remove-bot`, { token: people[0].token, body: { playerId: people[1].id } })).body.code).toBe("NOT_A_BOT")
    const after = (await call(base, `/api/rooms/${code}/remove-bot`, { token: people[0].token, body: { playerId: bot.id } })).body as unknown as RoomView
    expect(after.players.map((p) => p.name)).toEqual(["Host", "Friend 1", "Bot 2"])
    const again = (await call(base, `/api/rooms/${code}/add-bot`, { token: people[0].token, body: {} })).body as unknown as RoomView
    expect(again.players.map((p) => p.name)).toEqual(["Host", "Friend 1", "Bot 2", "Bot 1"])

    await call(base, `/api/rooms/${code}/start`, { token: people[0].token, body: {} })
    expect((await call(base, `/api/rooms/${code}/add-bot`, { token: people[0].token, body: {} })).body.code).toBe("ROOM_STARTED")
  })

  it("one human and one bot is enough to start", async () => {
    const { base } = await start({ botDelayMs: 60_000 })
    const { code, people } = await roomWithBots(base, 1)
    expect((await call(base, `/api/rooms/${code}/start`, { token: people[0].token, body: {} })).body.status).toBe("playing")
  })

  it("a room left with only bots is removed", async () => {
    const { base } = await start()
    const { code, people } = await roomWithBots(base, 2)
    await call(base, `/api/rooms/${code}/leave`, { token: people[0].token, body: {} })
    expect((await call(base, `/api/rooms/${code}/preview`)).status).toBe(404)
  })

  it("nobody can act as a bot", async () => {
    const { base } = await start({ botDelayMs: 60_000 })
    const { code } = await roomWithBots(base, 1)
    expect((await call(base, `/api/rooms/${code}`, { token: "" })).status).toBe(401)
    expect((await call(base, `/api/rooms/${code}/actions`, { token: "", body: { actionId: randomUUID(), expectedRevision: 0, action: { type: "pass" } } })).status).toBe(401)
  })
})

describe("complete games with bots", () => {
  it.each([1, 2, 3])("1 human and %i bots play to a winner", async (bots) => {
    const { base } = await start()
    const { code, people } = await roomWithBots(base, bots)
    await call(base, `/api/rooms/${code}/start`, { token: people[0].token, body: {} })
    const end = await playOut(base, code, people)
    const game = end.game!
    expect(end.status).toBe("finished")
    expect(game.result!.winners.length).toBeGreaterThan(0)
    expect(game.players).toHaveLength(1 + bots)
    expect(new Set(game.players.map((p) => p.turns)).size).toBe(1)
    for (const p of end.players.filter((x) => x.bot)) {
      const moves = byPlayer(game.log, p.id).map((e) => e.type)
      expect(moves).toContain("collect")
      expect(moves).toContain("acquire")
    }
  })

  it("two humans and a bot finish together", async () => {
    const { base } = await start()
    const { code, people } = await roomWithBots(base, 1, 2)
    await call(base, `/api/rooms/${code}/start`, { token: people[0].token, body: {} })
    expect((await playOut(base, code, people)).status).toBe("finished")
  })

  it("bots reserve as well as collect and acquire", async () => {
    const { base } = await start()
    const seen = new Set<string>()
    for (let g = 0; g < 4 && !seen.has("reserve"); g++) {
      const { code, people } = await roomWithBots(base, 3)
      await call(base, `/api/rooms/${code}/start`, { token: people[0].token, body: {} })
      const end = await playOut(base, code, people)
      for (const p of end.players.filter((x) => x.bot)) for (const e of byPlayer(end.game!.log, p.id)) seen.add(e.type)
    }
    expect([...seen].sort()).toEqual(expect.arrayContaining(["reserve", "collect", "acquire"]))
  })
})

describe("bot turn execution", () => {
  it("waits the configured delay before moving, then moves on its own", async () => {
    const { base } = await start({ botDelayMs: 200 })
    const { code, people } = await roomWithBots(base, 1)
    await call(base, `/api/rooms/${code}/start`, { token: people[0].token, body: {} })
    let room = await view(base, code, people[0].token)
    if (room.game!.players[room.game!.active].id === people[0].id) {
      const take = Object.fromEntries(Object.keys(room.game!.supply.resources).slice(0, 3).map((k) => [k, 1]))
      room = (await call(base, `/api/rooms/${code}/actions`, { token: people[0].token, body: { actionId: randomUUID(), expectedRevision: 0, action: { type: "collect", take } } })).body.room as unknown as RoomView
    }
    const before = room.revision
    await sleep(60)
    expect((await view(base, code, people[0].token)).revision).toBe(before)
    await sleep(400)
    const after = await view(base, code, people[0].token)
    expect(after.revision).toBe(before + 1)
    expect(after.game!.players[after.game!.active].id).toBe(people[0].id)
  })

  it("a fixed game seed reproduces the whole game", async () => {
    const run = async () => {
      const { base } = await start({ seed: () => "fixed-room-seed" })
      const { code, people } = await roomWithBots(base, 3)
      await call(base, `/api/rooms/${code}/start`, { token: people[0].token, body: {} })
      const end = await playOut(base, code, people)
      // Player ids are random per room; compare by seat.
      let json = JSON.stringify(end.game)
      end.game!.players.forEach((p, i) => (json = json.replaceAll(p.id, `seat-${i}`)))
      return json
    }
    expect(await run()).toBe(await run())
  })

  it("a bot due to move when the server stops moves after a restart", async () => {
    const first = await start({ botDelayMs: 60_000 })
    const { code, people } = await roomWithBots(first.base, 1)
    await call(first.base, `/api/rooms/${code}/start`, { token: people[0].token, body: {} })
    let room = await view(first.base, code, people[0].token)
    if (room.game!.players[room.game!.active].id === people[0].id) {
      const take = Object.fromEntries(Object.keys(room.game!.supply.resources).slice(0, 3).map((k) => [k, 1]))
      room = (await call(first.base, `/api/rooms/${code}/actions`, { token: people[0].token, body: { actionId: randomUUID(), expectedRevision: 0, action: { type: "collect", take } } })).body.room as unknown as RoomView
    }
    const pending = room.revision
    first.close()

    const second = await start({ botDelayMs: 0 }, first.dataDir)
    for (let i = 0; i < 100 && (await view(second.base, code, people[0].token)).revision === pending; i++) await sleep(10)
    expect((await view(second.base, code, people[0].token)).revision).toBe(pending + 1)
  })

  it("stops when the host ends the game", async () => {
    const { base } = await start({ botDelayMs: 100 })
    const { code, people } = await roomWithBots(base, 3)
    await call(base, `/api/rooms/${code}/start`, { token: people[0].token, body: {} })
    await call(base, `/api/rooms/${code}/end`, { token: people[0].token, body: {} })
    const at = (await view(base, code, people[0].token)).revision
    await sleep(350)
    const room = await view(base, code, people[0].token)
    expect(room.status).toBe("abandoned")
    expect(room.revision).toBe(at)
  })
})
