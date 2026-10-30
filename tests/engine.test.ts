import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  applyAction,
  permanentResources,
  canCollect,
  dueCost,
  points,
  projectGame,
  rank,
  setupGame,
  validatePack,
  type Action,
  type GameState,
  type ResourceCounts,
} from "../src/engine"
import { playBotGame } from "../src/bots"
import { activate, ctx, gemPack, KINDS, placeInMarket, PLAYERS, totalResources } from "./fixtures"

const C = ctx()
const two = () => {
  const s = setupGame(C, PLAYERS.slice(0, 2), "seed-1")
  activate(s, "p1")
  s.firstPlayer = 0
  return s
}
const act = (s: GameState, player: string, action: Action) => applyAction(C, s, player, action)
const ok = (s: GameState, player: string, action: Action) => {
  const r = act(s, player, action)
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`)
  return r.state
}
const err = (s: GameState, player: string, action: Action) => {
  const r = act(s, player, action)
  if (r.ok) throw new Error("expected rejection")
  return r.error
}

describe("fixture pack", () => {
  it("is valid", () => {
    const v = validatePack(gemPack())
    expect(v.issues).toEqual([])
  })
})

describe("setup", () => {
  it.each([
    [2, 4, 3],
    [3, 5, 4],
    [4, 7, 5],
  ])("%i players: %i resources per kind, %i achievements", (n, resources, achievements) => {
    const s = setupGame(C, PLAYERS.slice(0, n), "x")
    for (const k of KINDS) expect(s.supply.resources[k]).toBe(resources)
    expect(s.supply.wildcards).toBe(5)
    expect(s.achievements).toHaveLength(achievements)
    expect(s.players.every((p) => p.acquired.length === 0 && p.wildcards === 0 && Object.values(p.resources).every((t) => t === 0))).toBe(true)
    expect(s.active).toBe(s.firstPlayer)
  })

  it("deals four face-up cards per tier and four unique cards without duplicates", () => {
    const s = setupGame(C, PLAYERS.slice(0, 2), "x")
    for (const g of ["low", "mid", "high", "relic"]) expect(s.market[g].filter(Boolean)).toHaveLength(4)
    const all = [...Object.values(s.market).flat(), ...Object.values(s.decks).flat()]
    expect(new Set(all).size).toBe(all.length)
    expect(all).toHaveLength(gemPack().cards.length)
  })

  it("draws achievements in pack order", () => {
    const s = setupGame(C, PLAYERS, "x")
    const order = gemPack().achievements.map((a) => a.id)
    expect(s.achievements.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(s.achievements)
  })

  it("is deterministic per seed", () => {
    expect(setupGame(C, PLAYERS, "abc")).toEqual(setupGame(C, PLAYERS, "abc"))
    expect(setupGame(C, PLAYERS, "abc").market).not.toEqual(setupGame(C, PLAYERS, "abd").market)
  })

  it("leaves slots empty when a deck is short", () => {
    const pack = gemPack()
    pack.cardGroups[2].deckSize = 2
    pack.cards = pack.cards.filter((c) => c.group !== "high" || c.id === "high-1" || c.id === "high-2")
    const s = setupGame({ ...C, pack, index: ctx().index }, PLAYERS.slice(0, 2), "x")
    expect(s.market.high.filter(Boolean)).toHaveLength(2)
    expect(s.market.high.filter((x) => x === null)).toHaveLength(2)
  })

  it("rejects unsupported player counts", () => {
    expect(() => setupGame(C, PLAYERS.slice(0, 1), "x")).toThrow()
  })
})

describe("turn contract", () => {
  it("only the active player can act", () => {
    const s = two()
    expect(err(s, "p2", { type: "collect", take: { ruby: 1, sapphire: 1, emerald: 1 } }).code).toBe("NOT_YOUR_TURN")
    expect(err(s, "zz", { type: "pass" }).code).toBe("NOT_A_PLAYER")
  })

  it("a rejected action changes nothing", () => {
    const s = two()
    const before = structuredClone(s)
    err(s, "p1", { type: "collect", take: { ruby: 3 } })
    expect(s).toEqual(before)
  })

  it("a successful action advances revision, turn and active player without mutating input", () => {
    const s = two()
    const before = structuredClone(s)
    const n = ok(s, "p1", { type: "collect", take: { ruby: 1, sapphire: 1, emerald: 1 } })
    expect(s).toEqual(before)
    expect(n.revision).toBe(1)
    expect(n.turn).toBe(1)
    expect(n.active).toBe(1)
    expect(n.log.at(-1)).toMatchObject({ type: "collect", player: "p1" })
  })
})

describe("collect", () => {
  it("takes three different resources", () => {
    const n = ok(two(), "p1", { type: "collect", take: { ruby: 1, sapphire: 1, emerald: 1 } })
    expect(n.players[0].resources).toMatchObject({ ruby: 1, sapphire: 1, emerald: 1, onyx: 0 })
    expect(n.supply.resources).toMatchObject({ ruby: 3, sapphire: 3, emerald: 3, onyx: 4 })
  })

  it("takes two of one kind only when four are in supply", () => {
    const s = two()
    expect(ok(s, "p1", { type: "collect", take: { ruby: 2 } }).players[0].resources.ruby).toBe(2)
    s.supply.resources.ruby = 3
    expect(err(s, "p1", { type: "collect", take: { ruby: 2 } }).code).toBe("INVALID_COLLECT")
  })

  it("rejects other shapes", () => {
    const s = two()
    const takes: ResourceCounts[] = [{ ruby: 3 }, { ruby: 1, sapphire: 1 }, { ruby: 2, sapphire: 1 }, { ruby: 1, sapphire: 1, emerald: 1, onyx: 1 }, {}, { gold: 1 }]
    for (const take of takes) {
      expect(err(s, "p1", { type: "collect", take }).code).toBe("INVALID_COLLECT")
    }
  })

  it("cannot take missing resources", () => {
    const s = two()
    s.supply.resources.ruby = 0
    expect(err(s, "p1", { type: "collect", take: { ruby: 1, sapphire: 1, emerald: 1 } }).code).toBe("INVALID_COLLECT")
  })

  it("allows 1-2 different resources when fewer than three kinds remain", () => {
    const s = two()
    Object.assign(s.supply.resources, { ruby: 0, sapphire: 0, emerald: 0, onyx: 1, pearl: 3 })
    expect(ok(s, "p1", { type: "collect", take: { onyx: 1, pearl: 1 } }).players[0].resources).toMatchObject({ onyx: 1, pearl: 1 })
    expect(ok(s, "p1", { type: "collect", take: { pearl: 1 } }).players[0].resources.pearl).toBe(1)
    expect(err(s, "p1", { type: "collect", take: { pearl: 2 } }).code).toBe("INVALID_COLLECT")
  })

  it("is unavailable when the supply is empty", () => {
    const s = two()
    for (const k of KINDS) s.supply.resources[k] = 0
    expect(canCollect(C, s)).toBe(false)
    expect(err(s, "p1", { type: "collect", take: { ruby: 1 } }).code).toBe("INVALID_COLLECT")
  })

  it("requires an exact discard above ten held resources", () => {
    const s = two()
    Object.assign(s.players[0].resources, { ruby: 3, sapphire: 3, emerald: 3 })
    s.players[0].wildcards = 1
    const collect = { type: "collect", take: { onyx: 1, pearl: 1, ruby: 1 } } as const
    const required = err(s, "p1", collect)
    expect(required).toMatchObject({ code: "DISCARD_REQUIRED", details: { count: 3 } })
    expect(err(s, "p1", { ...collect, discard: { resources: { ruby: 2 } } }).code).toBe("INVALID_DISCARD")
    expect(err(s, "p1", { ...collect, discard: { resources: { ruby: 9 } } }).code).toBe("INVALID_DISCARD")
    const n = ok(s, "p1", { ...collect, discard: { resources: { ruby: 2 }, wildcards: 1 } })
    const p = n.players[0]
    expect(Object.values(p.resources).reduce((a, b) => a + b) + p.wildcards).toBe(10)
    expect(n.supply.wildcards).toBe(6)
    expect(n.log.at(-1)).toMatchObject({ type: "discard", resources: { ruby: 2 }, wildcards: 1 })
    for (const k of KINDS) expect(totalResources(n, k)).toBe(totalResources(s, k))
  })

  it("rejects a discard when none is needed", () => {
    expect(err(two(), "p1", { type: "collect", take: { ruby: 2 }, discard: { resources: { ruby: 1 } } }).code).toBe("INVALID_DISCARD")
  })
})

describe("reserve", () => {
  it("reserves a face-up tiered card, refills the slot, gives a wildcard", () => {
    const s = two()
    const card = s.market.mid[1]!
    const nextInDeck = s.decks.mid[0]
    const n = ok(s, "p1", { type: "reserve", cardId: card })
    expect(n.players[0].reserved).toEqual([card])
    expect(n.market.mid[1]).toBe(nextInDeck)
    expect(n.decks.mid).toHaveLength(s.decks.mid.length - 1)
    expect(n.players[0].wildcards).toBe(1)
    expect(n.supply.wildcards).toBe(4)
  })

  it("is still valid without a wildcard in supply", () => {
    const s = two()
    s.supply.wildcards = 0
    const n = ok(s, "p1", { type: "reserve", cardId: s.market.low[0]! })
    expect(n.players[0].wildcards).toBe(0)
    expect(n.players[0].reserved).toHaveLength(1)
  })

  it("leaves the slot empty when the deck is exhausted", () => {
    const s = two()
    s.decks.high = []
    expect(ok(s, "p1", { type: "reserve", cardId: s.market.high[0]! }).market.high[0]).toBeNull()
  })

  it("allows at most three reserved cards", () => {
    const s = two()
    s.players[0].reserved = ["low-14", "low-15", "mid-10"]
    expect(err(s, "p1", { type: "reserve", cardId: s.market.low[0]! }).code).toBe("RESERVE_FULL")
  })

  it("cannot reserve unique cards or cards not face-up", () => {
    const s = two()
    expect(err(s, "p1", { type: "reserve", cardId: s.market.relic[0]! }).code).toBe("NOT_RESERVABLE")
    expect(err(s, "p1", { type: "reserve", cardId: s.decks.low[0] }).code).toBe("CARD_UNAVAILABLE")
  })

  it("reserved cards are only signable by their owner, with no expiry", () => {
    let s = two()
    const card = s.market.low[0]!
    s = ok(s, "p1", { type: "reserve", cardId: card })
    s.players[1].wildcards = 5
    expect(err(s, "p2", { type: "acquire", cardId: card }).code).toBe("CARD_UNAVAILABLE")
    expect(err(s, "p2", { type: "reserve", cardId: card }).code).toBe("CARD_UNAVAILABLE")
    s.players[1].wildcards = 0
    for (let i = 0; i < 4; i++) s = ok(s, s.players[s.active].id, { type: "collect", take: { onyx: 1, pearl: 1, ruby: 1 } })
    expect(s.players[0].reserved).toContain(card)
  })
})

describe("acquire", () => {
  it("pays printed cost minus permanent discounts and returns resources to supply", () => {
    const s = two()
    placeInMarket(s, "mid", 0, "mid-1") // ruby 2, sapphire 2, emerald 2, permanent ruby, points 1
    const p = s.players[0]
    p.acquired = ["low-1", "low-6"] // permanent ruby (low-1), ruby (low-6)
    Object.assign(p.resources, { sapphire: 2, emerald: 2 })
    expect(dueCost(C, p, C.index.cards.get("mid-1")!)).toEqual({ sapphire: 2, emerald: 2 })
    const n = ok(s, "p1", { type: "acquire", cardId: "mid-1" })
    expect(n.players[0].resources).toMatchObject({ sapphire: 0, emerald: 0 })
    expect(n.supply.resources).toMatchObject({ sapphire: 6, emerald: 6 })
    expect(n.players[0].acquired).toContain("mid-1")
    expect(permanentResources(C, n.players[0]).ruby).toBe(3)
    expect(n.market.mid[0]).not.toBe("mid-1")
    expect(n.market.mid[0]).toBe(s.decks.mid[0])
  })

  it("uses wildcards for the shortfall, each wildcard once", () => {
    const s = two()
    placeInMarket(s, "low", 0, "low-1") // ruby 1, sapphire 1, emerald 1
    Object.assign(s.players[0].resources, { ruby: 1 })
    s.players[0].wildcards = 1
    expect(err(s, "p1", { type: "acquire", cardId: "low-1" }).code).toBe("CANNOT_AFFORD")
    s.players[0].wildcards = 2
    s.supply.wildcards = 3
    const n = ok(s, "p1", { type: "acquire", cardId: "low-1" })
    expect(n.players[0].wildcards).toBe(0)
    expect(n.supply.wildcards).toBe(5)
    expect(n.log.at(-1)).toMatchObject({ type: "acquire", paid: { ruby: 1 }, wildcards: 2 })
  })

  it("accepts an explicit wildcard allocation and rejects an invalid one", () => {
    const s = two()
    placeInMarket(s, "low", 0, "low-1")
    Object.assign(s.players[0].resources, { ruby: 1, sapphire: 1, emerald: 1 })
    s.players[0].wildcards = 1
    s.supply.wildcards = 4
    const n = ok(s, "p1", { type: "acquire", cardId: "low-1", wildcards: { ruby: 1 } })
    expect(n.players[0].resources.ruby).toBe(1)
    expect(n.players[0].wildcards).toBe(0)
    expect(err(s, "p1", { type: "acquire", cardId: "low-1", wildcards: { onyx: 1 } }).code).toBe("INVALID_PAYMENT")
    expect(err(s, "p1", { type: "acquire", cardId: "low-1", wildcards: { ruby: 2 } }).code).toBe("INVALID_PAYMENT")
  })

  it("awards printed points once and never consumes acquired cards", () => {
    const s = two()
    placeInMarket(s, "high", 0, "high-1") // 3/3/3, points 3
    Object.assign(s.players[0].resources, { ruby: 3, sapphire: 3, emerald: 3 })
    const n = ok(s, "p1", { type: "acquire", cardId: "high-1" })
    expect(points(C, n.players[0])).toBe(3)
    activate(n, "p1")
    placeInMarket(n, "low", 0, "low-1")
    Object.assign(n.players[0].resources, { sapphire: 1, emerald: 1 })
    const m = ok(n, "p1", { type: "acquire", cardId: "low-1" })
    expect(m.players[0].acquired).toEqual(["high-1", "low-1"])
    expect(points(C, m.players[0])).toBe(3)
  })

  it("signs from the reserved area and removes the reserved card", () => {
    let s = two()
    const card = "low-3" // ruby 4, points 1
    placeInMarket(s, "low", 0, card)
    s = ok(s, "p1", { type: "reserve", cardId: card })
    const marketAfterReserve = structuredClone(s.market)
    activate(s, "p1")
    s.players[0].resources.ruby = 3
    const n = ok(s, "p1", { type: "acquire", cardId: card }) // 3 ruby + 1 wildcard
    expect(n.players[0].reserved).toEqual([])
    expect(n.players[0].acquired).toEqual([card])
    expect(n.market).toEqual(marketAfterReserve)
    expect(n.log.at(-1)).toMatchObject({ from: "reserved", wildcards: 1 })
  })

  it("allows one unique card per player, market only", () => {
    const s = two()
    placeInMarket(s, "relic", 0, "relic-1") // ruby 3, onyx 3
    placeInMarket(s, "relic", 1, "relic-3")
    Object.assign(s.players[0].resources, { ruby: 6, onyx: 4 })
    const n = ok(s, "p1", { type: "acquire", cardId: "relic-1" })
    activate(n, "p1")
    expect(err(n, "p1", { type: "acquire", cardId: "relic-3" }).code).toBe("UNIQUE_LIMIT")
    expect(n.market.relic.filter(Boolean)).toHaveLength(4)
  })

  it("cannot acquire deck cards or other players' reserved cards", () => {
    const s = two()
    s.players[0].resources = { ruby: 9, sapphire: 9, emerald: 9, onyx: 9, pearl: 9 }
    expect(err(s, "p1", { type: "acquire", cardId: s.decks.low[0] }).code).toBe("CARD_UNAVAILABLE")
    expect(err(s, "p1", { type: "acquire", cardId: "nope" }).code).toBe("CARD_UNAVAILABLE")
  })
})

describe("achievements", () => {
  const withAchievements = (ids: string[]) => {
    const s = two()
    s.achievements = ids
    return s
  }

  it("claims automatically in pack order, once, and never refills", () => {
    const s = withAchievements(["pair", "two-pairs", "four"])
    placeInMarket(s, "low", 0, "low-2")
    s.players[0].acquired = ["low-1", "low-3", "low-4"]
    s.players[0].resources = { ruby: 0, sapphire: 0, emerald: 0, onyx: 2, pearl: 1 }
    const n = ok(s, "p1", { type: "acquire", cardId: "low-2" })
    expect(n.players[0].achievements).toEqual(["pair", "two-pairs"])
    expect(n.claimed).toEqual({ pair: "p1", "two-pairs": "p1" })
    expect(n.achievements).toEqual(["pair", "two-pairs", "four"])
    expect(points(C, n.players[0])).toBe(1 + 2 + 4) // low-3 is worth 1
    expect(n.log.filter((e) => e.type === "claim").map((e) => (e as { achievement: string }).achievement)).toEqual(["pair", "two-pairs"])

    // Opponent qualifying later cannot claim again.
    n.players[1].acquired = ["low-8"]
    n.players[1].resources = { ruby: 1, sapphire: 1, emerald: 1, onyx: 0, pearl: 0 }
    placeInMarket(n, "low", 1, "low-9") // r5 below pairs low-8 + low-9 for this check
    const pack = gemPack()
    pack.relationships.push({ id: "r5", label: "Late pair", cardIds: ["low-8", "low-9"], note: "Fixture", source: "Fixture" })
    const c2 = { ...C, pack, index: { ...C.index, pack } }
    const r = applyAction(c2, n, "p2", { type: "acquire", cardId: "low-9" })
    if (!r.ok) throw new Error(r.error.message)
    const m = r.state
    expect(m.players[1].achievements).toEqual([])
    expect(m.players[0].achievements).toEqual(["pair", "two-pairs"])
  })

  it("two disjoint pairs do not reuse a card", () => {
    const s = withAchievements(["two-pairs"])
    placeInMarket(s, "low", 0, "low-5") // onyx 2, pearl 1
    s.players[0].acquired = ["low-1", "low-2"] // r1; r3 (low-2, low-5) would overlap
    s.players[0].resources = { ruby: 0, sapphire: 0, emerald: 1, onyx: 0, pearl: 0 } // ruby and sapphire are discounted
    expect(ok(s, "p1", { type: "acquire", cardId: "low-5" }).players[0].achievements).toEqual([])
  })

  it("evaluates every predicate type", () => {
    const cases: [string, string[], boolean][] = [
      ["trio", ["low-6", "low-7", "mid-1"], true],
      ["trio", ["low-6", "low-7"], false],
      ["ruby-4", ["low-1", "low-6", "low-11", "mid-1"], true],
      ["ruby-4", ["low-1", "low-6", "low-11", "relic-1"], false], // unique group not counted by default
      ["rainbow", ["low-1", "low-2", "low-3", "low-4", "low-5"], true],
      ["rainbow", ["low-1", "low-2", "low-3", "low-4"], false],
      ["spread", ["low-1", "low-2", "low-3", "low-6", "low-7"], true],
      ["spread", ["low-1", "low-6", "low-11", "mid-1", "mid-6"], false],
      ["high-3", ["high-1", "high-2", "high-3"], true],
      ["four", ["low-1", "low-2", "mid-1", "high-1"], true],
      ["four", ["low-1", "low-2", "low-3", "mid-1"], false],
      ["six", ["low-1", "low-2", "low-3", "low-4", "low-5", "high-1"], true],
      ["eight", ["low-1", "low-2", "low-3", "low-4", "low-5", "low-6", "low-7", "low-8", "relic-1"], true],
      ["eight", ["low-1", "low-2", "low-3", "low-4", "low-5", "low-6", "low-7", "low-8"], false],
    ]
    for (const [id, acquired, expected] of cases) {
      const a = C.pack.achievements.find((x) => x.id === id)!
      const r = { acquired, achievements: [] }
      expect([id, acquired.join(","), evaluateAch(a.requirement, r)]).toEqual([id, acquired.join(","), expected])
    }
  })

  it("supports claimed-category and any predicates", () => {
    const pack = gemPack()
    pack.achievements.push({ id: "meta", category: "fame", name: "Meta", description: "x", points: 1, requirement: { type: "any", of: [{ type: "claimedCategory", category: "history", min: 2 }, { type: "cardCount", min: 20 }] } })
    expect(validatePack(pack).issues).toEqual([])
    const c = ctx()
    const full = { ...c, pack, index: { ...c.index, achievementCategory: new Map(pack.achievements.map((a) => [a.id, a.category])) } }
    const s = setupGame(full, PLAYERS.slice(0, 2), "x")
    activate(s, "p1")
    s.achievements = ["pair", "two-pairs", "meta"]
    placeInMarket(s, "low", 0, "low-2")
    s.players[0].acquired = ["low-1", "low-3", "low-4"]
    s.players[0].resources = { ruby: 0, sapphire: 0, emerald: 0, onyx: 2, pearl: 1 }
    const r = applyAction(full, s, "p1", { type: "acquire", cardId: "low-2" })
    expect(r.ok && r.state.players[0].achievements).toEqual(["pair", "two-pairs", "meta"])
  })
})

import { evaluate } from "../src/engine"
function evaluateAch(req: Parameters<typeof evaluate>[1], subject: { acquired: string[]; achievements: string[] }) {
  return evaluate(C.index, req, subject)
}

describe("final round and ranking", () => {
  it("reaching the target ends the game only after equal turns", () => {
    const c3 = ctx()
    const s = setupGame(c3, PLAYERS.slice(0, 3), "x")
    s.firstPlayer = 0
    s.active = 1 // p2 triggers in the middle of the round
    s.achievements = []
    s.players[1].acquired = ["high-1", "high-2", "high-3", "high-4"] // 3+4+5+3 = 15
    let n = ok(s, "p2", { type: "collect", take: { ruby: 1, sapphire: 1, emerald: 1 } })
    expect(n.finalRound).toEqual({ triggeredBy: "p2", turn: 1 })
    expect(n.status).toBe("playing")
    expect(n.active).toBe(2)
    n = ok(n, "p3", { type: "collect", take: { ruby: 1, sapphire: 1, emerald: 1 } })
    expect(n.status).toBe("finished")
    expect(n.result!.winners).toEqual(["p2"])
  })

  it("the first player triggering still gives everyone a turn", () => {
    const s = two()
    s.achievements = []
    s.players[0].acquired = ["high-1", "high-2", "high-3", "high-4"]
    let n = ok(s, "p1", { type: "collect", take: { ruby: 1, sapphire: 1, emerald: 1 } })
    expect(n.status).toBe("playing")
    n = ok(n, "p2", { type: "collect", take: { ruby: 1, sapphire: 1, emerald: 1 } })
    expect(n.status).toBe("finished")
    expect(n.players.map((p) => p.turns)).toEqual([1, 1])
    expect(act(n, "p1", { type: "pass" }).ok).toBe(false)
  })

  it("ranks by points, then fewest acquired, then shared", () => {
    const s = setupGame(C, PLAYERS, "x")
    s.players[0].acquired = ["high-1"] // 3
    s.players[1].acquired = ["low-3", "low-7", "mid-1"] // 1+1+1 = 3
    s.players[2].acquired = ["mid-2", "low-1"] // 2
    s.players[3].acquired = ["mid-2"] // 2
    const r = rank(C, s)
    expect(r.winners).toEqual(["p1"])
    expect(r.standings.map((x) => [x.playerId, x.rank])).toEqual([["p1", 1], ["p2", 2], ["p4", 3], ["p3", 4]])
    s.players[1].acquired = ["high-4"]
    expect(rank(C, s).winners).toEqual(["p1", "p2"])
    expect(rank(ctx({ tieBreak: "shared" }), s).standings.filter((x) => x.rank === 3)).toHaveLength(2)
  })
})

describe("pass", () => {
  it("is only allowed with no legal action", () => {
    const s = two()
    expect(err(s, "p1", { type: "pass" }).code).toBe("PASS_NOT_ALLOWED")
    for (const k of KINDS) s.supply.resources[k] = 0
    s.players[0].reserved = ["low-14", "low-15", "mid-10"]
    expect(ok(s, "p1", { type: "pass" }).log.at(-1)).toMatchObject({ type: "pass" })
  })
})

describe("projection", () => {
  it("hides deck order and seed during play", () => {
    const s = two()
    const p = projectGame(s)
    expect(p).not.toHaveProperty("decks")
    expect(p.seed).toBeNull()
    expect(p.deckCounts.low).toBe(s.decks.low.length)
  })
})

describe("full games", () => {
  it.each([2, 3, 4])("%i bots play to a finish with invariants intact", (n) => {
    for (let g = 0; g < 10; g++) {
      let state = setupGame(C, PLAYERS.slice(0, n), `seed-${n}-${g}`)
      const initial = structuredClone(state)
      state = playBotGame(C, state, `game-${n}-${g}`)
      expect(state.status).toBe("finished")
      const turns = state.players.map((p) => p.turns)
      expect(new Set(turns).size).toBe(1)
      expect(state.players.some((p) => points(C, p) >= 15)).toBe(true)
      for (const k of KINDS) expect(totalResources(state, k)).toBe(totalResources(initial, k))
      expect(state.supply.wildcards + state.players.reduce((a, p) => a + p.wildcards, 0)).toBe(5)
      const cards = [
        ...Object.values(state.market).flat().filter(Boolean),
        ...Object.values(state.decks).flat(),
        ...state.players.flatMap((p) => [...p.reserved, ...p.acquired]),
      ]
      expect(new Set(cards).size).toBe(gemPack().cards.length)
      expect(cards).toHaveLength(gemPack().cards.length)
      expect(state.players.every((p) => p.reserved.length <= 3 && p.resources && Object.values(p.resources).reduce((a, b) => a + b) + p.wildcards <= 10)).toBe(true)
      const revisions = state.log.map((e) => e.revision)
      expect(revisions).toEqual(revisions.slice().sort((a, b) => a - b))
      const claimed = Object.keys(state.claimed)
      expect(new Set(claimed).size).toBe(claimed.length)
    }
  })

  it("is replayable from seed and actions", () => {
    const a = playBotGame(C, setupGame(C, PLAYERS.slice(0, 3), "replay"), "bots")
    const b = playBotGame(C, setupGame(C, PLAYERS.slice(0, 3), "replay"), "bots")
    expect(a).toEqual(b)
  })
})

describe("engine boundary", () => {
  it("engine source has no theme-specific vocabulary", () => {
    const dir = join(import.meta.dirname, "../src/engine")
    for (const file of readdirSync(dir)) {
      const src = readFileSync(join(dir, file), "utf8").toLowerCase()
      for (const word of ["basketball", "superstar", "nba", "coach", "highflyer", "shooter", "playmaker", "defender", "rebounder"]) {
        expect(src.includes(word), `${file} mentions ${word}`).toBe(false)
      }
      expect(/from "(\.\.\/|react|@\/)/.test(src), `${file} imports outside the engine`).toBe(false)
    }
  })
})
