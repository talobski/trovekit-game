import { describe, expect, it } from "vitest"
import { starfallContent } from "./fixtures/starfall"
import { contentIssues as validateDraft } from "../src/shared/content"
import { describePredicate, diffContent, parseImport, slug, syncDeckSizes, uniqueId } from "../src/admin/model"

const base = () => starfallContent()
const { pack: starfall, rules: starfallRules } = starfallContent()

describe("admin model", () => {
  it("reports no changes for identical content", () => {
    expect(diffContent(base(), base())).toEqual([])
  })

  it("describes rule, card, achievement and relationship changes", () => {
    const a = base()
    const b = base()
    b.rules.targetPoints = 18
    b.pack.cards[0].points = 1
    b.pack.cards.push({ ...b.pack.cards[1], id: "new-card", name: "New Card" })
    b.pack.achievements.splice(0, 1)
    b.pack.relationships[0].label = "Renamed"
    const changes = diffContent(a, b)
    expect(changes).toContainEqual({ area: "Rules", kind: "changed", id: "targetPoints", detail: "targetPoints: 15 → 18" })
    expect(changes).toContainEqual(expect.objectContaining({ area: "Cards", kind: "changed", id: a.pack.cards[0].id }))
    expect(changes).toContainEqual(expect.objectContaining({ area: "Cards", kind: "added", id: "new-card" }))
    expect(changes).toContainEqual(expect.objectContaining({ area: "Achievements", kind: "removed", id: "bond-of-two" }))
    expect(changes).toContainEqual(expect.objectContaining({ area: "Relationships", kind: "changed", id: a.pack.relationships[0].id }))
  })

  it("keeps deck sizes in step with card counts", () => {
    const c = base()
    const loose = c.pack.cards.find((x) => !c.pack.relationships.some((r) => r.cardIds.includes(x.id)))!
    c.pack.cards = c.pack.cards.filter((x) => x.id !== loose.id)
    expect(validateDraft(c).some((i) => i.message.includes("deckSize"))).toBe(true)
    expect(validateDraft({ ...c, pack: syncDeckSizes(c.pack) })).toEqual([])
  })

  it("parses imports and blocks bad files with clear messages", () => {
    expect(parseImport("{nope", starfallRules)).toMatchObject({ ok: false, message: expect.stringMatching(/^Not valid JSON/) })
    expect(parseImport("[1,2]", starfallRules)).toEqual({ ok: false, message: "Expected a JSON object" })
    expect(parseImport(JSON.stringify({ hello: 1 }), starfallRules)).toMatchObject({ ok: false })
    expect(parseImport("x".repeat(1024 * 1024 + 1), starfallRules)).toEqual({ ok: false, message: "File is larger than 1 MB" })
    const bare = parseImport(JSON.stringify(starfall), starfallRules)
    expect(bare.ok && validateDraft(bare.content as never)).toEqual([])
    const bad = base()
    bad.pack.relationships[0].cardIds[1] = "ghost"
    const parsed = parseImport(JSON.stringify(bad), starfallRules)
    expect(parsed.ok && validateDraft(parsed.content as never)[0]).toMatchObject({ path: "pack.relationships.0.cardIds.1" })
  })

  it("summarizes requirements in pack words", () => {
    const a = starfall.achievements.find((x) => x.id === "starfall-legend")!
    expect(describePredicate(starfall, a.requirement)).toBe("8+ First Years or Adepts or Masters cards and 2+ Masters cards")
    expect(describePredicate(starfall, starfall.achievements.find((x) => x.id === "tidecallers")!.requirement)).toBe("4+ First Years or Adepts or Masters cards with Tide as permanent resource")
  })

  it("makes safe unique ids", () => {
    expect(slug("Renée O'Hara")).toBe("renee-ohara")
    expect(slug("Mireille Coldspire")).toBe("mireille-coldspire")
    expect(uniqueId("Aria Ashgrove", ["aria-ashgrove"])).toBe("aria-ashgrove-2")
  })
})
