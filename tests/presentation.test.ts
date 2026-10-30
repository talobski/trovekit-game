import { describe as group, expect, it } from "vitest"
import { applyAction, createContext, projectGame, resolvePlaceholders, setupGame, type Pack } from "../src/engine"
import { actionError, noun, pastVerbs, presentPack, withArticle } from "../src/app/game/presentation"
import { describe } from "../src/app/game/pack-view"
import { blankPack } from "../src/admin/import-model"
import { starfallContent } from "./fixtures/starfall"

/*
 * presentPack() is the single display projection: optional labels get their
 * generic defaults and placeholders resolve to the pack's current words. It
 * treats no pack specially. Every word below comes from pack configuration.
 */

const { pack: starfall, rules } = starfallContent()

/** Starfall re-labelled with another theme's words: labels are the only thing that changes. */
function relabelled(): Pack {
  const p = structuredClone(starfall)
  Object.assign(p.labels, {
    collect: "Draft {label:resources}",
    collected: "Drafted {label:resources}",
    acquire: "Recruit",
    acquired: "Recruited",
    resource: "Prospect",
    resources: "Prospects",
    card: "Star",
    cards: "Stars",
  })
  return p
}

it("resolves labels that name other labels, at display time only", () => {
  const p = relabelled()
  expect(presentPack(p).labels).toMatchObject({ collect: "Draft Prospects", collected: "Drafted Prospects", acquire: "Recruit" })
  expect(p.labels.collect).toBe("Draft {label:resources}")
  p.labels.resources = "Future stars"
  expect(presentPack(p).labels.collect).toBe("Draft Future stars")
  // The blank template reads in plain generic words.
  expect(presentPack(blankPack("x", "X").pack).labels).toMatchObject({ collect: "Collect Resources", collected: "Collected Resources", acquire: "Acquire" })
})

it("treats every pack the same, whatever its id", () => {
  const p = relabelled()
  const as = (id: string) => presentPack({ ...p, id }).labels
  expect(as("basketball")).toEqual(as("anything-else"))
})

it("describes log entries in the pack's past tense", () => {
  const p = presentPack(relabelled())
  const ctx = createContext(p, rules)
  const game = setupGame(ctx, [{ id: "a", name: "Ana" }, { id: "b", name: "Ben" }], "labels")
  for (const [type, action] of [["collect", "Drafted Prospects"], ["reserve", "Reserved"], ["acquire", "Recruited"]] as const) {
    const entry = { type, revision: 1, player: "a", resources: { ember: 1 }, card: p.cards[0].id, wildcard: 0, paid: {}, wildcards: 0, from: "market" as const }
    expect(describe(ctx, projectGame(game), entry)?.action).toBe(action)
  }
  expect(pastVerbs(presentPack(starfall))).toEqual({ collect: "Gathered", reserve: "Reserved", acquire: "Bonded" })
})

it("presentation does not alter action results or serialized event types", () => {
  const raw = createContext(starfall, rules)
  const shown = createContext(presentPack(relabelled()), rules)
  const state = setupGame(raw, [{ id: "a", name: "Ana" }, { id: "b", name: "Ben" }], "mechanics")
  const player = state.players[state.active].id
  const action = { type: "collect" as const, take: { ember: 1, tide: 1, gale: 1 } }
  expect(applyAction(shown, state, player, action)).toEqual(applyAction(raw, state, player, action))
})

it("formats affordability errors in the pack's words without changing API errors", () => {
  const error = { code: "CANNOT_AFFORD", message: "Not enough resources to acquire this card" }
  expect(actionError(presentPack(relabelled()), error)).toBe("Not enough prospects to recruit this star")
  expect(actionError(presentPack(starfall), error)).toBe("Not enough motes to bond this card")
  expect(error.message).toBe("Not enough resources to acquire this card")
  expect(actionError(starfall, { code: "STALE_REVISION", message: "Refresh" })).toBe("Refresh")
})

group("achievement description placeholders", () => {
  const resolved = (p: Pack) => Object.fromEntries(presentPack(p).achievements.map((a) => [a.id, a.description]))
  const withPlaceholders = () => {
    const p = structuredClone(starfall)
    p.achievements[8].description = "{label:acquire} 3 {label:cards} from {group:masters}."
    p.achievements[3].description = "{label:acquire} 4 with {kind:stone} as their permanent resource."
    return p
  }

  it("read in the pack's current words, with no placeholders left", () => {
    const d = resolved(withPlaceholders())
    expect(d[starfall.achievements[8].id]).toBe("Bond 3 Cards from Masters.")
    expect(d[starfall.achievements[3].id]).toBe("Bond 4 with Stone as their permanent resource.")
    for (const text of Object.values(d)) expect(text).not.toMatch(/[{}]/)
  })

  it("renamed groups, kinds and labels follow everywhere; requirements keep their ids", () => {
    const p = withPlaceholders()
    p.cardGroups[2].label = "Archmages"
    p.resourceKinds.find((k) => k.id === "stone")!.label = "Granite"
    Object.assign(p.labels, { acquire: "Enrol", cards: "Students" })
    const d = resolved(p)
    expect(d[starfall.achievements[8].id]).toBe("Enrol 3 Students from Archmages.")
    expect(d[starfall.achievements[3].id]).toBe("Enrol 4 with Granite as their permanent resource.")
    expect(presentPack(p).achievements.map((a) => a.requirement)).toEqual(starfall.achievements.map((a) => a.requirement))
  })

  it("plain-text descriptions pass through unchanged", () => {
    expect(presentPack(starfall).achievements.map((a) => a.description)).toEqual(starfall.achievements.map((a) => a.description))
  })

  it("resolution is display only: content is unchanged; unknown placeholders stay as written", () => {
    const p = withPlaceholders()
    const before = JSON.stringify(p)
    presentPack(p)
    expect(JSON.stringify(p)).toBe(before)
    expect(resolvePlaceholders(p, "{group:tier9} stays")).toBe("{group:tier9} stays")
    expect(resolvePlaceholders(relabelled(), "{label:collect}")).toBe("Draft Prospects")
  })
})

group("optional card nouns (labels.card / labels.cards)", () => {
  // The Resource strength legend, built from pack labels exactly as board-parts does.
  const legend = (p: Pack) => {
    const shown = presentPack(p)
    return [`From held ${shown.labels.resources.toLowerCase()}`, `From ${shown.labels.acquired.toLowerCase()} ${noun(shown, "cards")}`]
  }

  it("a pack's nouns complete the legend: 'From held prospects' / 'From recruited stars'", () => {
    expect(legend(relabelled())).toEqual(["From held prospects", "From recruited stars"])
  })

  it("packs without the nouns fall back to Card / Cards", () => {
    expect(starfall.labels.card).toBeUndefined()
    expect(legend(starfall)).toEqual(["From held motes", "From bonded cards"])
    expect(presentPack(starfall).labels).toMatchObject({ card: "Card", cards: "Cards" })
  })

  it("a pack's own nouns follow everywhere the UI uses them", () => {
    const films = structuredClone(starfall)
    films.labels = { ...films.labels, card: "Film", cards: "Films", acquire: "Screen", acquired: "Screened" }
    expect(legend(films)[1]).toBe("From screened films")
    expect(actionError(presentPack(films), { code: "CANNOT_AFFORD", message: "x" })).toBe("Not enough motes to screen this film")
    expect(withArticle(noun(presentPack(films), "card"))).toBe("a film")
    expect(withArticle("artifact")).toBe("an artifact")
  })

  it("work as {label:card} placeholders, with the default when absent", () => {
    expect(resolvePlaceholders(relabelled(), "{label:acquire} 3 {label:cards}")).toBe("Recruit 3 Stars")
    expect(resolvePlaceholders(starfall, "One {label:card}")).toBe("One Card")
  })
})
