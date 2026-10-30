import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  BOT_LEVELS,
  botSeed,
  chooseBotAction,
  chooseGreedyAction,
  chooseNormalAction,
  chooseRandomAction,
  legalActions,
  playBotGame,
} from "../src/bots"
import { applyAction, canAcquire, createContext, points, setupGame, type Action, type GameState } from "../src/engine"
import { activate, ctx as gemCtx, KINDS, PLAYERS } from "./fixtures"
import { starfallContent } from "./fixtures/starfall"

// A complete themed pack (the Starfall fixture), as players would install.
const full = starfallContent()
const pack = createContext(full.pack, full.rules)
const G = gemCtx()

/** A two-player gem game where p1 acts, with no achievements and a market we control. */
function scenario(market: Partial<Record<"low" | "mid" | "high" | "relic", (string | null)[]>>): GameState {
  const s = setupGame(G, PLAYERS.slice(0, 2), "scenario")
  activate(s, "p1")
  s.firstPlayer = 0
  s.achievements = []
  for (const g of ["low", "mid", "high", "relic"] as const) s.market[g] = market[g] ?? [null, null, null, null]
  return s
}

const decide = (s: GameState, seed = "t") => chooseNormalAction(G, s, seed)

describe("Normal bot: legal, complete games", () => {
  it.each([2, 3, 4])("%i Normal bots finish 40 full-pack games with only legal moves", (n) => {
    const mix = { collect: 0, reserve: 0, acquire: 0, pass: 0 }
    for (let g = 0; g < 40; g++) {
      // playBotGame throws if a bot ever proposes an illegal move.
      const end = playBotGame(pack, setupGame(pack, PLAYERS.slice(0, n), `legal-${n}-${g}`), `bots-${n}-${g}`)
      expect(end.status).toBe("finished")
      expect(new Set(end.players.map((p) => p.turns)).size).toBe(1)
      expect(end.players.some((p) => points(pack, p) >= full.rules.targetPoints)).toBe(true)
      for (const e of end.log) if (e.type in mix) mix[e.type as keyof typeof mix]++
    }
    expect(mix.collect).toBeGreaterThan(0)
    expect(mix.acquire).toBeGreaterThan(0)
    expect(mix.reserve).toBeGreaterThan(0)
  })

  it("works on a second, differently themed pack", () => {
    for (let g = 0; g < 20; g++) expect(playBotGame(G, setupGame(G, PLAYERS, `gems-${g}`), `gb-${g}`).status).toBe("finished")
  })

  it("every Normal decision is accepted by the engine, mid-game included", () => {
    let state = setupGame(pack, PLAYERS.slice(0, 3), "every-move")
    while (state.status === "playing") {
      const action = chooseNormalAction(pack, state, `m-${state.revision}`)
      const r = applyAction(pack, state, state.players[state.active].id, action)
      expect(r.ok, JSON.stringify(action)).toBe(true)
      if (!r.ok) break
      state = r.state
    }
  })
})

describe("Normal bot: reproducible", () => {
  it("same state and seed, same move", () => {
    const s = setupGame(pack, PLAYERS.slice(0, 4), "repro")
    expect(chooseNormalAction(pack, s, "seed-a")).toEqual(chooseNormalAction(pack, s, "seed-a"))
    expect(chooseBotAction("normal", pack, s, "seed-a")).toEqual(chooseNormalAction(pack, s, "seed-a"))
  })

  it("a fixed game seed replays a whole bot game exactly", () => {
    const a = playBotGame(pack, setupGame(pack, PLAYERS.slice(0, 4), "fixed"), "fixed-bots")
    const b = playBotGame(pack, setupGame(pack, PLAYERS.slice(0, 4), "fixed"), "fixed-bots")
    expect(a).toEqual(b)
  })

  it("seeds come from game seed, revision and seat, not player ids", () => {
    expect(botSeed("abc", 7, 2)).toBe("abc:7:2")
  })

  it("offers exactly one level for now", () => {
    expect(BOT_LEVELS).toEqual(["normal"])
  })
})

describe("Normal bot: decisions", () => {
  it("signs the card that completes an achievement", () => {
    const s = scenario({ low: ["low-5", "low-1", null, null] }) // both cost ruby, sapphire, emerald; low-1 completes the r1 pair
    s.achievements = ["pair"]
    s.players[0].acquired = ["low-2"]
    s.players[0].resources = { ruby: 1, sapphire: 1, emerald: 1, onyx: 0, pearl: 0 }
    expect(decide(s)).toEqual({ type: "acquire", cardId: "low-1" })
  })

  it("prefers points over a cheap card", () => {
    const s = scenario({ low: ["low-1", null, null, null], high: ["high-1", null, null, null] })
    s.players[0].resources = { ruby: 3, sapphire: 3, emerald: 3, onyx: 0, pearl: 0 }
    expect(decide(s)).toEqual({ type: "acquire", cardId: "high-1" })
  })

  it("collects what its target still needs", () => {
    const s = scenario({ mid: ["mid-2", null, null, null] }) // onyx 4, pearl 2
    const a = decide(s)
    expect(a.type).toBe("collect")
    const take = (a as Extract<Action, { type: "collect" }>).take
    expect((take.onyx ?? 0) + (take.pearl ?? 0)).toBeGreaterThanOrEqual(2)
  })

  it("takes two of one kind when that is all the target needs", () => {
    const s = scenario({ mid: ["mid-2", null, null, null] })
    s.players[0].resources = { ruby: 0, sapphire: 0, emerald: 0, onyx: 0, pearl: 2 }
    expect(decide(s)).toMatchObject({ type: "collect", take: { onyx: 2 } })
  })

  it("reserves a valuable card an opponent is about to acquire", () => {
    const s = scenario({ high: ["high-1", null, null, null] }) // ruby 3, sapphire 3, emerald 3, 3 points
    s.players[1].resources = { ruby: 3, sapphire: 3, emerald: 3, onyx: 0, pearl: 0 }
    expect(decide(s)).toMatchObject({ type: "reserve", cardId: "high-1" })
  })

  it("reserves when the supply cannot help", () => {
    const s = scenario({ low: ["low-1", "low-2", null, null] })
    for (const k of KINDS) s.supply.resources[k] = 0
    expect(decide(s).type).toBe("reserve")
  })

  it("returns the resources it needs least when over the cap", () => {
    const s = scenario({ high: ["high-2", null, null, null] }) // onyx 6, pearl 3
    s.players[0].resources = { ruby: 2, sapphire: 2, emerald: 0, onyx: 4, pearl: 2 }
    const a = decide(s) as Extract<Action, { type: "collect" }>
    expect(a.type).toBe("collect")
    expect(a.discard).toBeDefined()
    expect(a.discard!.resources?.onyx ?? 0).toBe(0)
    expect(a.discard!.resources?.pearl ?? 0).toBe(0)
    expect(applyAction(G, s, "p1", a).ok).toBe(true)
  })

  it("never tries for a second unique card", () => {
    const s = scenario({ relic: ["relic-3", null, null, null] })
    s.players[0].acquired = ["relic-1"]
    s.players[0].resources = { ruby: 3, sapphire: 0, emerald: 0, onyx: 3, pearl: 0 }
    expect(canAcquire(G, s, s.players[0], "relic-3")?.code).toBe("UNIQUE_LIMIT")
    expect(decide(s)).not.toMatchObject({ type: "acquire", cardId: "relic-3" })
  })

  it("passes only when nothing is legal", () => {
    const s = scenario({ low: ["low-1", null, null, null] })
    for (const k of KINDS) s.supply.resources[k] = 0
    s.players[0].reserved = ["low-14", "low-15", "mid-10"]
    expect(legalActions(G, s)).toEqual([{ type: "pass" }])
    expect(decide(s)).toEqual({ type: "pass" })
  })
})

describe("Normal bot: strength", () => {
  const headToHead = (opponent: typeof chooseRandomAction, games: number, n: number) => {
    let wins = 0
    for (let g = 0; g < games; g++) {
      const seat = PLAYERS[g % n].id
      const end = playBotGame(pack, setupGame(pack, PLAYERS.slice(0, n), `h2h-${n}-${g}`), `h2h-${g}`, (id) => (id === seat ? chooseNormalAction : opponent), 2000)
      if (end.result!.winners.includes(seat)) wins++
    }
    return wins / games
  }

  it("beats random-move players almost always", () => {
    expect(headToHead(chooseRandomAction, 30, 2)).toBeGreaterThanOrEqual(0.9)
  })

  it("beats a greedy points-first player most of the time", () => {
    // Measured at 84% (2 players) and 60% (4 players, even share 25%) over 200 games.
    expect(headToHead(chooseGreedyAction, 60, 2)).toBeGreaterThanOrEqual(0.65)
  })
})

describe("bot boundary", () => {
  it("the engine never imports bot code; bots only use the engine's public modules", () => {
    const engineDir = join(import.meta.dirname, "../src/engine")
    for (const f of readdirSync(engineDir)) expect(readFileSync(join(engineDir, f), "utf8")).not.toMatch(/bots/)
    const botDir = join(import.meta.dirname, "../src/bots")
    for (const f of readdirSync(botDir)) {
      const imports = [...readFileSync(join(botDir, f), "utf8").matchAll(/from "([^"]+)"/g)].map((m) => m[1])
      for (const i of imports) expect(i.startsWith("../engine/") || i.startsWith("./"), `${f} imports ${i}`).toBe(true)
    }
  })
})
