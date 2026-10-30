import { describe, expect, it } from "vitest"
import { blankPack, defaultRules } from "../content"
import { cardPrompt } from "../src/admin/card-prompt"
import { costPatterns, economyGuidelines, packEconomy, RECOMMENDED_SPLITS } from "../src/admin/economy-prompt"
import { AI_PROMPT, fullPackPrompt } from "../src/admin/import-model"
import type { Pack } from "../src/engine/schema"
import { starfallContent } from "./fixtures/starfall"

/* The AI prompts plan permanent resources, demand, cost patterns and points together, as advice. */

const full = fullPackPrompt({ id: "moon-garden", name: "Moon Garden", description: "A calm game about moonlit flowers." })
const phase = (p: string, from: string, to?: string) => p.slice(p.indexOf(from), to ? p.indexOf(to) : undefined)
const template = blankPack("t", "T").pack.cardGroups
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0)

describe("recommended card counts", () => {
  it("60, 70 and 90 split into tiers divisible by five, giving each resource the same number of cards", () => {
    expect(RECOMMENDED_SPLITS.map((s) => [s.total, ...s.tiers])).toEqual([[60, 25, 20, 15], [70, 30, 25, 15], [90, 40, 30, 20]])
    for (const s of RECOMMENDED_SPLITS) {
      expect(sum(s.tiers)).toBe(s.total)
      for (const t of s.tiers) expect(t % 5).toBe(0)
    }
    for (const [total, each] of [[60, 12], [70, 14], [90, 18]]) {
      expect(full).toContain(`${total} cards as`)
      expect(full).toContain(`(${each} cards providing each resource)`)
    }
  })

  it("are recommendations: any other count is accepted, with the remainder spread as evenly as possible", () => {
    const discover = phase(full, "PHASE 1: DISCOVER", "PHASE 2: DESIGN")
    expect(discover).toContain("Recommended:")
    expect(discover).toContain("Any other count works too: the resources then differ by a card or so.")
    expect(full).toContain("Otherwise spread the remainder so no resource has more than one card more than another, rotating which resources get the extra card from tier to tier.")
    expect(full).toContain("when my choices differ, follow my choices")
  })
})

describe("economy guidelines", () => {
  const text = economyGuidelines(defaultRules, template)

  it("balance permanent resources per tier and overall, never at random", () => {
    expect(text).toContain("never assign them at random")
    expect(text).toContain("the same number per resource within each tier when its card count is divisible by five, and across all tiers")
  })

  it("balance demand both by cards requiring each resource and by units required, per tier and overall", () => {
    expect(text).toContain("the number of cards that require each resource and the total units of each resource required, within each tier and across the pack")
  })

  it("suggest adjustable own-resource shares: about 10 to 20% in the first tier, 40 to 60% above", () => {
    expect(text).toContain("about 10 to 20% in the first tier, about 40 to 60% in the higher tiers")
    expect(text).toContain("Adjust it when the design calls for it, and never make most cards depend chiefly on their own resource.")
  })

  it("offer reusable cost patterns that fit each tier's real range, rotated across resources", () => {
    expect(text).toContain("rotate which resources take each amount")
    expect(text).toContain("Tier 1 (cost 3 to 5, points 0 to 1): 3, 2+2, 2+2+1, 1+1+1+1")
    expect(text).toContain("Tier 2 (cost 6 to 8, points 1 to 3): 3+2+2, 5+3, 6")
    // 5+3+3+3 totals 14, above the template's tier 3 maximum of 12: never offered there.
    expect(text).toContain("Tier 3 (cost 9 to 12, points 3 to 5): 6+3+3, 7+3, 4+4+4")
    expect(text).not.toContain("5+3+3+3")
  })

  it("every offered pattern fits its group, for any cost range", () => {
    for (const [min, max] of [[3, 5], [6, 8], [9, 12], [9, 14], [1, 2], [0, 1], [20, 30], [60, 60]])
      for (const tier of [0, 1, 2, 4]) {
        const patterns = costPatterns({ cost: { min, max } }, tier)
        expect(patterns.length, `${min}-${max} tier ${tier}`).toBeGreaterThan(0)
        for (const p of patterns) {
          expect(sum(p)).toBeGreaterThanOrEqual(Math.max(1, min))
          expect(sum(p)).toBeLessThanOrEqual(max)
          expect(p.length).toBeLessThanOrEqual(5)
          for (const n of p) expect(n >= 1 && n <= 15).toBe(true)
        }
      }
    expect(costPatterns({ cost: { min: 9, max: 14 } }, 2).map((p) => p.join("+"))).toContain("5+3+3+3")
  })

  it("weigh concentration, discounts, supply and wildcards rather than total cost, from the actual rules", () => {
    expect(text).toContain("total cost is not difficulty")
    expect(text).toContain("Each resource has 4 with 2 players, 5 with 3 players and 7 with 4 players in the supply")
    expect(text).toContain("an amount of one resource above 4 can only be paid with permanent discounts or wildcards when 2 play")
    expect(text).toContain("the points goal of 15")
    const noWild = economyGuidelines({ ...defaultRules, wildcardsOnReserve: 0 }, template)
    expect(noWild).not.toContain("wildcard")
  })
})

describe("the full-pack conversation", () => {
  it("summarizes the economy in Design, before approval, separating choices from recommendations", () => {
    const design = phase(full, "PHASE 2: DESIGN", "PHASE 3: GENERATE")
    expect(design).toContain("include a short economy summary")
    for (const part of ["each tier's number of cards", "how many cards provide each resource, per tier and overall", "cards requiring it and units required", "the cost patterns planned for each tier", "how a game is expected to progress"]) expect(design).toContain(part)
    expect(design).toContain("Mark which parts are my choices and which are your recommendations")
    expect(design).toContain("leave out calculations unless I ask")
    expect(design.indexOf("economy summary")).toBeLessThan(design.indexOf("Ask me to approve it"))
  })

  it("checks the economy privately after approval, asking before changing an approved decision", () => {
    const generate = phase(full, "PHASE 3: GENERATE")
    expect(generate.indexOf("Write it only after I approve")).toBeLessThan(generate.indexOf("check the economy privately against the approved plan"))
    expect(generate).toContain("If a correction would change something I approved, ask me first instead.")
    expect(generate).toContain("never claim the cards are balanced: only playing the game shows that")
  })

  it("keeps the generic prompt single-shot, with the guidelines and a check that needs no approval", () => {
    expect(AI_PROMPT).toContain("Card economy (advisory design guidelines")
    expect(AI_PROMPT).toContain("check the economy privately:")
    expect(AI_PROMPT).not.toContain("ask me first")
  })

  it("names no other game", () => {
    const economy = economyGuidelines(defaultRules, template)
    expect(economy).not.toMatch(/\blike (the )?[A-Z][a-z]+\b|inspired by|similar to/i)
  })
})

describe("adding cards to an existing pack", () => {
  /** Two tiers, five kinds, a handful of cards with known numbers. */
  function small(): Pack {
    const pack = structuredClone(starfallContent().pack)
    const [a, b] = pack.cardGroups
    pack.cards = [
      { id: "c1", group: a.id, name: "One", permanentResource: "ember", points: 0, cost: { tide: 2, gale: 1 } },
      { id: "c2", group: a.id, name: "Two", permanentResource: "ember", points: 0, cost: { ember: 1, tide: 1, gale: 1 } },
      { id: "c3", group: a.id, name: "Three", permanentResource: "tide", points: 1, cost: { tide: 2, gale: 1 } },
      { id: "c4", group: b.id, name: "Four", permanentResource: "stone", points: 2, cost: { stone: 3, spark: 3 } },
    ]
    return pack
  }

  it("states the existing economy from the cards: providers, demand in cards and units, own-resource share, patterns, room", () => {
    const text = packEconomy(small())
    const [a, b] = small().cardGroups
    expect(text).toContain(`- ${a.label} (3 cards, room for 197 more):`)
    expect(text).toContain("Provide: Ember 2, Tide 1, Gale 0, Stone 0, Spark 0.")
    expect(text).toContain("Required by: Ember 1 card / 1 units, Tide 3 cards / 5 units, Gale 3 cards / 3 units, Stone 0 cards / 0 units, Spark 0 cards / 0 units.")
    expect(text).toContain("Cost their own resource: 2 of 3 (67%).")
    expect(text).toContain("Cost patterns: 2+1 (2), 1+1+1 (1).")
    expect(text).toContain(`- ${b.label} (1 card, room for 199 more):`)
    expect(text).toContain("- All tiered cards (4):")
    expect(text).toContain("The pack holds 4 of at most 400 cards")
  })

  const prompt = cardPrompt(starfallContent())

  it("plans additions from that picture without rewriting existing cards, keeping duplicate safeguards", () => {
    expect(prompt).toContain("Current card economy, computed by Trovekit from the existing cards:")
    expect(prompt).toContain("- All tiered cards (66):")
    expect(prompt).toContain("Do not change, rewrite or rebalance existing cards unless I explicitly ask to update one.")
    expect(prompt).toContain("a batch does not need to be perfectly even on its own, and what I ask for comes first")
    expect(prompt).toContain("Never reuse an existing ID unless I explicitly ask you to update that card")
    expect(prompt).toContain("unique names across all tiered cards, including the existing cards")
  })

  it("summarizes the batch's effect before approval and checks it privately afterwards", () => {
    const design = phase(prompt, "PHASE 2: DESIGN", "PHASE 3: GENERATE")
    expect(design).toContain("how the new cards change the number of cards providing and requiring each resource")
    expect(design.indexOf("economy summary")).toBeLessThan(design.indexOf("Ask me to approve it"))
    const generate = phase(prompt, "PHASE 3: GENERATE")
    expect(generate.indexOf("Write them only after I approve")).toBeLessThan(generate.indexOf("check the economy privately"))
    expect(generate.indexOf("check the economy privately")).toBeLessThan(generate.indexOf("Return ONLY a JSON array"))
  })

  it("uses the pack's own rules and tiers, and handles a pack with no cards", () => {
    expect(prompt).toContain("First Years (cost 3 to 5")
    const empty = starfallContent()
    empty.pack.cards = []
    const fresh = cardPrompt(empty)
    expect(fresh).toContain("There are no cards yet, so plan the first ones with the guidelines above.")
    expect(fresh).not.toContain("Current card economy")
  })
})
