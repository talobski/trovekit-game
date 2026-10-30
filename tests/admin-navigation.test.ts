import { describe, expect, it } from "vitest"
import { blankPack } from "../content"
import { contentIssues } from "../src/shared/content"
import { LIBRARY, NEW_PACK, packRoute, parseRoute, routeHash, transition } from "../src/admin/routes"
import { setupSteps } from "../src/admin/setup"
import { issueSection } from "../src/admin/validation"
import { starfallContent } from "./fixtures/starfall"

describe("admin routes", () => {
  it("round-trips the library and every pack section", () => {
    expect(parseRoute("#/library")).toEqual(LIBRARY)
    expect(parseRoute("#/packs/anime-legends")).toEqual(packRoute("anime-legends"))
    expect(parseRoute("#/packs/anime-legends/cards")).toEqual(packRoute("anime-legends", "cards"))
    for (const section of ["overview", "cards", "resources", "rules", "achievements", "relationships", "versions", "preview", "settings"] as const) {
      const route = packRoute("p1", section)
      expect(parseRoute(routeHash(route))).toEqual(route)
    }
    expect(routeHash(packRoute("p1"))).toBe("#/packs/p1")
    expect(parseRoute("#/new")).toEqual(NEW_PACK)
    expect(routeHash(NEW_PACK)).toBe("#/new")
    // A pack whose ID is "new" keeps its own address.
    expect(parseRoute("#/packs/new")).toEqual(packRoute("new"))
  })

  it("leaves an empty hash to the admin and sends anything unrecognised to the library", () => {
    expect(parseRoute("")).toBeNull()
    expect(parseRoute("#")).toBeNull()
    expect(parseRoute("#/")).toBeNull()
    for (const hash of ["#/nope", "#/packs", "#/packs/Bad Id!", "#/packs/%E0%A4%A", "#/packs/a/b/c", "#/packs/<script>"]) expect(parseRoute(hash)).toEqual(LIBRARY)
    // An unknown section still opens the pack, on its Overview.
    expect(parseRoute("#/packs/p1/nope")).toEqual(packRoute("p1"))
  })

  it("asks before replacing unsaved changes, and only when another pack opens", () => {
    const clean = { packId: "a", dirty: false }
    const dirty = { packId: "a", dirty: true }
    expect(transition(dirty, LIBRARY)).toBe("stay")
    // Opening the creation page keeps the editor; creating a pack asks separately.
    expect(transition(dirty, NEW_PACK)).toBe("stay")
    expect(transition(dirty, packRoute("a", "rules"))).toBe("stay")
    expect(transition(dirty, packRoute("b"))).toBe("confirm")
    expect(transition(clean, packRoute("b"))).toBe("load")
    expect(transition(null, packRoute("b"))).toBe("load")
  })
})

describe("issue sections", () => {
  it("points each field at the section that edits it", () => {
    expect(issueSection("pack.resourceKinds.0.label")).toBe("resources")
    expect(issueSection("pack.resourceArt.src")).toBe("resources")
    expect(issueSection("pack.cardGroups.1.label")).toBe("cards")
    expect(issueSection("pack.cards.3.points")).toBe("cards")
    expect(issueSection("pack.achievementCategories.0.id")).toBe("achievements")
    expect(issueSection("pack.relationships.0.cardIds.1")).toBe("relationships")
    expect(issueSection("pack.labels.collect")).toBe("settings")
    expect(issueSection("pack.name")).toBe("settings")
    expect(issueSection("rules.targetPoints")).toBe("rules")
    expect(issueSection("JSON")).toBe("settings")
  })
})

describe("setup checklist", () => {
  const state = (steps: ReturnType<typeof setupSteps>) => Object.fromEntries(steps.map((s) => [s.id, s.state]))

  it("a new blank pack: its template resources and groups are usable, cards are next", () => {
    const steps = setupSteps(blankPack("p1", "P1"))
    expect(state(steps)).toEqual({ resources: "done", groups: "done", cards: "todo", rules: "pending", publish: "pending" })
    expect(steps.find((s) => s.id === "publish")?.detail).toBe("Add cards to every group before publishing.")
  })

  it("a complete pack is ready to publish", () => {
    const steps = setupSteps(starfallContent())
    expect(state(steps)).toEqual({ resources: "done", groups: "done", cards: "done", rules: "done", publish: "todo" })
    expect(steps.at(-1)?.detail).toBe("Ready to publish.")
  })

  it("never marks a step done when validation could not check it", () => {
    const content = starfallContent()
    content.pack.cards[0].name = "" // A shape problem: the semantic checks cannot run.
    expect(contentIssues(content).every((i) => i.path.startsWith("pack.cards"))).toBe(true)
    const steps = state(setupSteps(content))
    expect(steps.cards).toBe("attention")
    expect(steps.resources).toBe("pending")
    expect(steps.groups).toBe("pending")
    expect(steps.rules).toBe("pending")
    expect(steps.publish).toBe("attention")
  })

  it("flags the step whose data has the problem", () => {
    const content = starfallContent()
    content.pack.resourceKinds[1].icon = content.pack.resourceKinds[0].icon
    content.rules.targetPoints = 0
    const steps = state(setupSteps(content))
    expect(steps.resources).toBe("attention")
    expect(steps.rules).toBe("attention")
    expect(steps.cards).toBe("done")
  })

  it("a group without cards keeps Add cards open", () => {
    const content = starfallContent()
    const last = content.pack.cardGroups.at(-1)!
    content.pack.cards = content.pack.cards.filter((c) => c.group !== last.id)
    const cards = setupSteps(content).find((s) => s.id === "cards")!
    expect(cards.state).toBe("todo")
    expect(cards.detail).toContain(`No cards in ${last.label} yet`)
  })
})
