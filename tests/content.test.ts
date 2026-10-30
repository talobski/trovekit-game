import { describe, expect, it } from "vitest"
import { blankPackTemplate, defaultRules } from "../content/index.ts"
import {
  createContext,
  createRng,
  evaluate,
  indexPack,
  points,
  setupGame,
  validatePack,
  validateRules,
  type Pack,
  type Predicate,
} from "../src/engine"
import { playBotGame } from "../src/bots"
import { PLAYERS } from "./fixtures"
import { starfallContent } from "./fixtures/starfall"

// Starfall is the complete example fixture; it is never installed by default.
const { pack, rules: rulesJson } = starfallContent()
const clone = () => structuredClone(pack) as Pack
const issuesOf = (p: unknown) => {
  const v = validatePack(p)
  return v.ok ? [] : v.issues
}

describe("generic templates", () => {
  it("the default rules are valid", () => {
    expect(validateRules(defaultRules).ok).toBe(true)
  })

  it("the blank pack template is a valid draft that needs cards before publishing", () => {
    const blank = blankPackTemplate
    expect(blank.cards).toEqual([])
    expect(validateRules(defaultRules, blank).ok).toBe(true)
    // Only missing cards stop it from validating: no references to anything else.
    const v = validatePack(blank)
    expect(v.ok).toBe(false)
    expect(v.ok ? [] : v.issues.map((i) => i.path.split(".").slice(0, 2).join("."))).toEqual(expect.arrayContaining(["cards"]))
    expect((v.ok ? [] : v.issues).every((i) => /^(cards|cardGroups\.\d\.deckSize|achievements\.\d\.requirement)/.test(i.path))).toBe(true)
    // Player-facing words are generic: nothing from any particular theme.
    const words = [blank.name, ...Object.values(blank.labels), ...blank.resourceKinds.map((k) => k.label), ...blank.cardGroups.map((g) => g.label), ...blank.achievements.flatMap((x) => [x.name, x.description])]
    expect(words.join(" | ")).not.toMatch(/basketball|prospect|franchise|recruit|draft|star\b|stars\b/i)
  })
})

describe("Starfall fixture pack", () => {
  it("passes schema and semantic validation", () => {
    expect(issuesOf(pack)).toEqual([])
    const rules = validateRules(rulesJson, pack as Pack)
    expect(rules.ok ? [] : rules.issues).toEqual([])
  })

  it("has the shape the other tests rely on", () => {
    const p = pack as Pack
    expect(p.resourceKinds.map((k) => k.id)).toEqual(["ember", "tide", "gale", "stone", "spark"])
    const stars = p.cards
    expect(stars.length).toBeGreaterThanOrEqual(60)
    expect(p.cardGroups.map((g) => [g.id, g.kind])).toEqual([["first-years", "tiered"], ["adepts", "tiered"], ["masters", "tiered"]])
    expect(rulesJson.market).toEqual({ tieredSlots: 4, uniqueSlots: 0 })
    expect(rulesJson.uniqueLimitPerPlayer).toBe(0)
    const game = setupGame(createContext(p, rulesJson), PLAYERS, "three-tiers")
    expect(Object.keys(game.market)).toEqual(["first-years", "adepts", "masters"])
    expect(Object.values(game.market).flat().filter(Boolean)).toHaveLength(12)
    expect(p.achievements).toHaveLength(12)
    const byCategory = Object.groupBy(p.achievements, (a) => a.category)
    expect(Object.values(byCategory).map((a) => a!.length)).toEqual([3, 3, 3, 3])
    expect(p.resourceKinds.map((k) => k.icon)).toEqual(["flame", "droplet", "wind", "mountain", "zap"])
    expect(p.labels.resources).toBe("Motes")
    expect(new Set(stars.map((c) => c.name)).size).toBe(stars.length)
    for (const k of p.resourceKinds) expect(stars.filter((c) => c.permanentResource === k.id).length).toBeGreaterThanOrEqual(8)
    expect(p.relationships.filter((r) => r.cardIds.length === 2).length).toBeGreaterThanOrEqual(4)
    expect(p.relationships.filter((r) => r.cardIds.length === 3).length).toBeGreaterThanOrEqual(1)
    for (const r of p.relationships) expect(r.note.length && r.source.length).toBeTruthy()
  })

  it("respects tier cost and points bands", () => {
    const bands = { "first-years": [3, 5, 0, 1], adepts: [6, 8, 1, 3], masters: [9, 12, 3, 5] } as const
    for (const c of (pack as Pack).cards) {
      const [cmin, cmax, pmin, pmax] = bands[c.group as keyof typeof bands]
      const total = Object.values(c.cost).reduce((a, b) => a + b, 0)
      expect(total).toBeGreaterThanOrEqual(cmin)
      expect(total).toBeLessThanOrEqual(cmax)
      expect(c.points).toBeGreaterThanOrEqual(pmin)
      expect(c.points).toBeLessThanOrEqual(pmax)
      expect(Object.values(c.cost).every((n) => n > 0)).toBe(true)
    }
  })

  it("requires eight acquired cards including two Masters for Starfall Legend", () => {
    const p = pack as Pack
    const requirement = p.achievements.find((a) => a.id === "starfall-legend")!.requirement
    const index = indexPack(p)
    const lower = p.cards.filter((c) => c.group !== "masters").slice(0, 7).map((c) => c.id)
    const tier3 = p.cards.filter((c) => c.group === "masters").slice(0, 2).map((c) => c.id)
    expect(evaluate(index, requirement, { acquired: [...lower.slice(0, 6), ...tier3], achievements: [] })).toBe(true)
    expect(evaluate(index, requirement, { acquired: [...lower, tier3[0]], achievements: [] })).toBe(false)
    expect(evaluate(index, requirement, { acquired: [...lower.slice(0, 5), ...tier3], achievements: [] })).toBe(false)
  })
})

describe("validator rejects invalid packs", () => {
  const cases: [string, (p: Pack) => void, RegExp][] = [
    ["dangling relationship", (p) => (p.relationships[0].cardIds[0] = "nobody"), /Unknown card "nobody"/],
    ["unknown card in a relationship", (p) => (p.relationships[0].cardIds[0] = "phil-jackson"), /Unknown card/],
    ["duplicate card id", (p) => (p.cards[1].id = p.cards[0].id), /Duplicate id/],
    ["duplicate tiered name", (p) => (p.cards[1].name = p.cards[0].name), /already appears/],
    ["cost out of band", (p) => (p.cards[0].cost = { tide: 9 }), /outside First Years range/],
    ["points out of band", (p) => (p.cards[0].points = 5), /Points 5 is outside/],
    ["unknown cost kind", (p) => (p.cards[0].cost = { dunker: 3 }), /Unknown resource kind "dunker"/],
    ["unknown permanent resource", (p) => (p.cards[0].permanentResource = "dunker"), /Unknown resource kind/],
    ["wrong deck size", (p) => (p.cardGroups[0].deckSize = 99), /deckSize is 99/],
    ["unknown group", (p) => (p.cards[0].group = "tier9"), /Unknown card group/],
    ["four kinds", (p) => p.resourceKinds.pop(), /Exactly 5/],
    ["unknown effect key", (p) => Object.assign(p.cards[0], { effect: "steal" }), /Unrecognized key/i],
    ["unknown predicate", (p) => ((p.achievements[0] as { requirement: unknown }).requirement = { type: "script", code: "x" }), /invalid/i],
    ["markup in a name", (p) => (p.cards[0].name = "<img src=x onerror=alert(1)>"), /Markup/],
    ["remote art", (p) => (p.cards[0].art = { src: "https://evil.example/x.png" }), /Art must be a path/],
    ["javascript art", (p) => (p.cards[0].art = { src: "javascript:alert(1)" }), /Art must be a path/],
    ["unknown achievement category", (p) => (p.achievements[0].category = "fame"), /Unknown category/],
    ["unreachable count", (p) => ((p.achievements[3].requirement as { min: number }).min = 40), /Needs 40 matching cards/],
    ["bad version", (p) => (p.version = "one"), /version like/],
    ["unknown group placeholder", (p) => (p.achievements[8].description = "Recruit 3 from {group:tier9}."), /achievements\.8\.description: Unknown card group "tier9" in \{group:tier9\}/],
    ["unknown kind placeholder", (p) => (p.achievements[3].description = "4 with a {kind:dunker} card."), /achievements\.3\.description: Unknown resource kind "dunker"/],
    ["unknown label placeholder", (p) => (p.achievements[0].description = "{label:signs} a duo."), /achievements\.0\.description: Unknown label "signs"/],
    ["markup in the card noun", (p) => (p.labels.card = "<b>Student</b>"), /labels\.card: Markup/],
    ["over-long card noun", (p) => (p.labels.cards = "x".repeat(21)), /labels\.cards: At most 20/],
    ["malformed placeholder", (p) => (p.achievements[0].description = "{group masters} or {group:masters"), /achievements\.0\.description: Braces are only for/],
  ]
  it.each(cases)("%s", (_name, mutate, message) => {
    const p = clone()
    mutate(p)
    const issues = issuesOf(p)
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.map((i) => `${i.path}: ${i.message}`).join("\n")).toMatch(message)
    for (const i of issues) expect(i.path).toBeTruthy()
  })

  it("treats the card nouns as optional, and accepts {label:card} placeholders without them", () => {
    const p = clone()
    delete p.labels.card
    delete p.labels.cards
    p.achievements[0].description = "{label:acquire} a {label:card} and two {label:cards}."
    expect(issuesOf(p)).toEqual([])
  })

  it("accepts placeholders that reference existing groups, kinds and labels", () => {
    const p = clone()
    p.achievements[0].description = "{label:acquire} {group:first-years}, {kind:spark} and {label:resources}."
    expect(issuesOf(p)).toEqual([])
  })

  it("rejects rules that do not fit the pack", () => {
    const r = validateRules({ ...rulesJson, achievementsDrawn: { "2": 3, "3": 4, "4": 13 } }, pack as Pack)
    expect(r.ok).toBe(false)
    expect(validateRules({ ...rulesJson, holdingCap: "ten" }).ok).toBe(false)
    expect(validateRules({ ...rulesJson, extra: true }).ok).toBe(false)
  })
})

describe("achievement reachability", () => {
  const p = pack as Pack
  const index = indexPack(p)
  const stars = p.cards.map((c) => c.id)

  /** Search for a acquired set of at most `max` stars that satisfies the predicate. */
  function witness(pred: Predicate, max: number): string[] | null {
    const rng = createRng("witness")
    for (let i = 0; i < 40000; i++) {
      const set = new Set<string>()
      const rels = rng.shuffle(p.relationships).slice(0, rng.int(3))
      for (const r of rels) r.cardIds.forEach((c) => set.add(c))
      const target = 3 + rng.int(max - 2)
      for (const id of rng.shuffle(stars)) {
        if (set.size >= target) break
        set.add(id)
      }
      const acquired = [...set].slice(0, max)
      if (evaluate(index, pred, { acquired, achievements: [] })) return acquired
    }
    return null
  }

  it.each(p.achievements.map((a) => [a.id, a] as const))("%s is satisfiable with at most 10 acquired cards", (_id, a) => {
    expect(witness(a.requirement, 10)).not.toBeNull()
  })

  it("every achievement is claimed in simulated 15-point games", () => {
    const ctx = createContext(p, rulesJson)
    const claimed = new Map<string, number>()
    for (const n of [2, 3, 4]) {
      for (let g = 0; g < 120; g++) {
        const state = playBotGame(ctx, setupGame(ctx, PLAYERS.slice(0, n), `reach-${n}-${g}`), `bots-${n}-${g}`)
        expect(state.status).toBe("finished")
        expect(state.players.some((pl) => points(ctx, pl) >= 15)).toBe(true)
        for (const id of Object.keys(state.claimed)) claimed.set(id, (claimed.get(id) ?? 0) + 1)
      }
    }
    for (const a of p.achievements) expect([a.id, (claimed.get(a.id) ?? 0) > 0]).toEqual([a.id, true])
  })
})
