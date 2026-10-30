import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defaultRules } from "../content/index.ts"
import { ContentStore } from "../server/content-store.ts"
import type { Content } from "../src/shared/content.ts"
import { starfallContent } from "./fixtures/starfall.ts"
import { createContext, type GameContext, type GameState, type Pack, type Rules, type ResourceCounts } from "../src/engine"

/** A deliberately non-basketball pack: proves the engine runs on any theme. */
export const KINDS = ["ruby", "sapphire", "emerald", "onyx", "pearl"] as const

function cards(group: string, count: number, costs: ResourceCounts[], points: (i: number) => number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${group}-${i + 1}`,
    group,
    name: `${group} ${i + 1}`,
    cost: costs[i % costs.length],
    permanentResource: KINDS[i % KINDS.length],
    points: points(i),
  }))
}

export function gemPack(): Pack {
  return {
    schemaVersion: 2,
    id: "gems",
    name: "Gem Guild",
    version: "1.0.0",
    labels: {
      game: "Gem Guild",
      collect: "Mine",
      collected: "Mined",
      reserve: "Hold",
      acquire: "Buy",
      resource: "Gem",
      resources: "Gems",
      wildcard: "Gold",
      wildcards: "Gold",
      reserved: "Held",
      acquired: "Owned",
      points: "Points",
      collection: "Guild",
      achievements: "Patrons",
    },
    resourceKinds: KINDS.map((id, i) => ({ id, label: id, tone: (["rose", "blue", "green", "slate", "amber"] as const)[i], icon: (["heart", "droplet", "leaf", "moon", "circle"] as const)[i] })),
    cardGroups: [
      { id: "low", label: "Low", kind: "tiered", deckSize: 15, cost: { min: 3, max: 5 }, points: { min: 0, max: 1 } },
      { id: "mid", label: "Mid", kind: "tiered", deckSize: 10, cost: { min: 6, max: 8 }, points: { min: 1, max: 3 } },
      { id: "high", label: "High", kind: "tiered", deckSize: 10, cost: { min: 9, max: 12 }, points: { min: 3, max: 5 } },
      { id: "relic", label: "Relic", kind: "unique", deckSize: 6, cost: { min: 6, max: 8 }, points: { min: 1, max: 3 } },
    ],
    cards: [
      ...cards("low", 15, [{ ruby: 1, sapphire: 1, emerald: 1 }, { onyx: 2, pearl: 1 }, { ruby: 4 }, { sapphire: 1, onyx: 1, pearl: 1, emerald: 1 }], (i) => (i % 4 === 2 ? 1 : 0)),
      ...cards("mid", 10, [{ ruby: 2, sapphire: 2, emerald: 2 }, { onyx: 4, pearl: 2 }, { emerald: 5, ruby: 2 }], (i) => 1 + (i % 3)),
      ...cards("high", 10, [{ ruby: 3, sapphire: 3, emerald: 3 }, { onyx: 6, pearl: 3 }, { pearl: 7, ruby: 3 }], (i) => 3 + (i % 3)),
      ...cards("relic", 6, [{ ruby: 3, onyx: 3 }, { sapphire: 4, pearl: 3 }], (i) => 1 + (i % 3)),
    ],
    achievementCategories: [
      { id: "history", label: "History" },
      { id: "mastery", label: "Mastery" },
      { id: "titles", label: "Titles" },
      { id: "fame", label: "Fame" },
    ],
    achievements: [
      { id: "pair", category: "history", name: "Pair", description: "One pair", points: 2, requirement: { type: "relationships", min: 1, size: 2 } },
      { id: "two-pairs", category: "history", name: "Two pairs", description: "Two disjoint pairs", points: 4, requirement: { type: "relationships", min: 2, size: 2, disjoint: true } },
      { id: "trio", category: "history", name: "Trio", description: "One trio", points: 4, requirement: { type: "relationships", min: 1, size: 3 } },
      { id: "ruby-4", category: "mastery", name: "Ruby", description: "4 ruby", points: 3, requirement: { type: "cardCount", min: 4, permanentResource: "ruby" } },
      { id: "onyx-4", category: "mastery", name: "Onyx", description: "4 onyx", points: 3, requirement: { type: "cardCount", min: 4, permanentResource: "onyx" } },
      { id: "pearl-4", category: "mastery", name: "Pearl", description: "4 pearl", points: 3, requirement: { type: "cardCount", min: 4, permanentResource: "pearl" } },
      { id: "spread", category: "titles", name: "Spread", description: "5 cards, 3 kinds", points: 4, requirement: { type: "all", of: [{ type: "cardCount", min: 5 }, { type: "distinctPermanentResources", min: 3 }] } },
      { id: "rainbow", category: "titles", name: "Rainbow", description: "All five", points: 5, requirement: { type: "distinctPermanentResources", min: 5 } },
      { id: "high-3", category: "titles", name: "Highs", description: "3 high", points: 5, requirement: { type: "cardCount", min: 3, groups: ["high"] } },
      { id: "four", category: "fame", name: "Four", description: "4 cards, 2 mid+", points: 2, requirement: { type: "all", of: [{ type: "cardCount", min: 4 }, { type: "cardCount", min: 2, groups: ["mid", "high"] }] } },
      { id: "six", category: "fame", name: "Six", description: "6 cards, 1 high", points: 3, requirement: { type: "all", of: [{ type: "cardCount", min: 6 }, { type: "cardCount", min: 1, groups: ["high"] }] } },
      { id: "eight", category: "fame", name: "Eight", description: "8 cards and a relic", points: 4, requirement: { type: "all", of: [{ type: "cardCount", min: 8 }, { type: "cardCount", min: 1, groups: ["relic"] }] } },
    ],
    relationships: [
      { id: "r1", label: "Low pair", cardIds: ["low-1", "low-2"], note: "Fixture", source: "Fixture" },
      { id: "r2", label: "Low pair two", cardIds: ["low-3", "low-4"], note: "Fixture", source: "Fixture" },
      { id: "r3", label: "Overlapping pair", cardIds: ["low-2", "low-5"], note: "Fixture", source: "Fixture" },
      { id: "r4", label: "Trio", cardIds: ["low-6", "low-7", "mid-1"], note: "Fixture", source: "Fixture" },
    ],
  }
}

/**
 * A fresh data directory with a pack published and active. A new installation
 * has an empty library, so tests that create rooms install their content explicitly.
 */
export function fixtureDataDir(prefix = "trovekit-", content: Content = starfallContent()): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  const store = new ContentStore(dir)
  const saved = store.publish(content, "Test fixture")
  if (!saved.ok || !store.activate(saved.version.id).ok) throw new Error(`Fixture content is invalid: ${JSON.stringify(saved)}`)
  return dir
}

export function rules(overrides: Partial<Rules> = {}): Rules {
  return { ...structuredClone(defaultRules), market: { tieredSlots: 4, uniqueSlots: 4 }, uniqueLimitPerPlayer: 1, ...overrides }
}

export function ctx(overrides: Partial<Rules> = {}): GameContext {
  return createContext(gemPack(), rules(overrides))
}

export const PLAYERS = [
  { id: "p1", name: "Ana" },
  { id: "p2", name: "Ben" },
  { id: "p3", name: "Cy" },
  { id: "p4", name: "Dee" },
]

/** Force a card into a given market slot (swapping with wherever it was) so tests are deterministic. */
export function placeInMarket(state: GameState, group: string, slot: number, cardId: string) {
  const prev = state.market[group][slot]
  const deckIdx = state.decks[group].indexOf(cardId)
  if (deckIdx >= 0) state.decks[group][deckIdx] = prev as string
  else {
    const otherSlot = state.market[group].indexOf(cardId)
    if (otherSlot >= 0) state.market[group][otherSlot] = prev
  }
  state.market[group][slot] = cardId
}

/** Make `playerId` the active player. */
export function activate(state: GameState, playerId: string) {
  state.active = state.players.findIndex((p) => p.id === playerId)
}

export function totalResources(state: GameState, kind: string) {
  return state.supply.resources[kind] + state.players.reduce((a, p) => a + (p.resources[kind] ?? 0), 0)
}
