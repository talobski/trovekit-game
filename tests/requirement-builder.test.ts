import { describe, expect, it } from "vitest"
import { PredicateSchema, type Predicate } from "../src/engine/schema"
import { packSemantics } from "../src/engine/validate"
import { changeType, explainRequirement, fitsForm, requirementProblems } from "../src/admin/requirement"
import { starfallContent } from "./fixtures/starfall"

/* The achievement requirement builder edits the existing requirement JSON; it adds no rules. */

const pack = starfallContent().pack
const say = (p: Predicate) => explainRequirement(pack, p)

describe("plain-language reading", () => {
  it("reads relationship requirements by size, as the engine counts them", () => {
    expect(say({ type: "relationships", min: 1 }).lines).toEqual(["Complete at least 1 relationship."])
    expect(say({ type: "relationships", min: 1, size: 2 }).lines).toEqual(["Complete at least 1 duo relationship."])
    expect(say({ type: "relationships", min: 1, size: 3 }).lines).toEqual(["Complete at least 1 trio relationship."])
    expect(say({ type: "relationships", min: 2, size: 2, disjoint: true }).lines).toEqual(["Complete at least 2 duo relationships, with no card shared between them."])
  })

  it("reads the other conditions in the pack's own names", () => {
    const [ember, tide] = pack.resourceKinds
    const [first, second] = pack.cardGroups
    expect(say({ type: "cardCount", min: 4 }).lines).toEqual(["Acquire at least 4 cards from any tiered group."])
    expect(say({ type: "cardCount", min: 1, groups: [second.id], permanentResource: ember.id }).lines).toEqual([`Acquire at least 1 card from ${second.label} with ${ember.label} as their permanent resource.`])
    expect(say({ type: "distinctPermanentResources", min: 3, groups: [first.id, second.id] }).lines).toEqual([`Acquire cards from ${first.label} or ${second.label} with at least 3 different permanent resources.`])
    const category = pack.achievementCategories[0]
    expect(say({ type: "claimedCategory", category: category.id, min: 2 }).lines).toEqual([`Have claimed at least 2 ${category.label} achievements.`])
    expect(say({ type: "all", of: [{ type: "cardCount", min: 2, permanentResource: tide.id }, { type: "relationships", min: 1 }] })).toEqual({
      lead: "Meet all of these:",
      lines: [`Acquire at least 2 cards from any tiered group with ${tide.label} as their permanent resource.`, "Complete at least 1 relationship."],
    })
    expect(say({ type: "any", of: [{ type: "relationships", min: 1, size: 3 }] }).lead).toBe("Meet any one of these:")
  })
})

describe("the form", () => {
  it("shows single conditions and one level of all/any; deeper nesting stays JSON", () => {
    expect(fitsForm({ type: "cardCount", min: 1 })).toBe(true)
    expect(fitsForm({ type: "all", of: [{ type: "cardCount", min: 1 }, { type: "relationships", min: 1 }] })).toBe(true)
    expect(fitsForm({ type: "all", of: [{ type: "any", of: [{ type: "cardCount", min: 1 }] }] })).toBe(false)
  })

  it("changing the type keeps the count where it fits and always produces a valid requirement", () => {
    expect(changeType(pack, { type: "cardCount", min: 4, groups: ["x"] }, "relationships")).toEqual({ type: "relationships", min: 4 })
    expect(changeType(pack, { type: "cardCount", min: 40 }, "distinctPermanentResources")).toEqual({ type: "distinctPermanentResources", min: 5 })
    expect(changeType(pack, { type: "relationships", min: 2 }, "claimedCategory")).toEqual({ type: "claimedCategory", category: pack.achievementCategories[0].id, min: 2 })
    // Even from an unfinished count, a new type starts valid.
    for (const type of ["distinctPermanentResources", "relationships", "claimedCategory"] as const)
      expect(PredicateSchema.safeParse(changeType(pack, { type: "cardCount", min: Number.NaN }, type)).success).toBe(true)
  })

  it("every requirement in the example pack is shown by the form", () => {
    for (const a of pack.achievements) expect(fitsForm(a.requirement), a.id).toBe(true)
  })
})

describe("problems in plain language", () => {
  it("names counts outside their range, per condition", () => {
    expect(requirementProblems(pack, { type: "relationships", min: 11 }, [], 0)).toEqual(["Required count must be a whole number from 1 to 10."])
    expect(requirementProblems(pack, { type: "all", of: [{ type: "cardCount", min: 2 }, { type: "distinctPermanentResources", min: Number.NaN }] }, [], 0)).toEqual(["Condition 2: Required count must be a whole number from 1 to 5."])
  })

  it("shows the pack's own checks for this achievement only, by condition", () => {
    const p = structuredClone(pack)
    const trios = p.relationships.filter((r) => r.cardIds.length === 3).length
    p.achievements[1].requirement = { type: "all", of: [{ type: "cardCount", min: 1 }, { type: "relationships", min: 10, size: 3 }] }
    const issues = packSemantics(p)
    expect(requirementProblems(p, p.achievements[1].requirement, issues, 1)).toEqual([`Condition 2: Needs 10 relationships but the pack has ${trios}.`])
    expect(requirementProblems(p, p.achievements[0].requirement, issues, 0)).toEqual([])
  })
})
