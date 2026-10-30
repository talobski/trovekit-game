import { expect, it } from "vitest"
import { blankPack } from "../content"
import { Card } from "../src/engine/schema"
import { DraftSchema, contentIssues } from "../src/shared/content"
import { cardPrompt, sampleCards } from "../src/admin/card-prompt"
import { importCards } from "../src/admin/import-model"
import { starfallContent } from "./fixtures/starfall"

it("derives prompts and examples from the current configuration, without installing cards", () => {
  const content = blankPack("garden", "Moon Garden")
  content.pack.resourceKinds[0].id = "petals"
  content.pack.resourceKinds[0].label = "Petals"
  content.pack.cardGroups[0].id = "seedlings"
  content.pack.cardGroups[0].cost = { min: 4, max: 6 }
  content.rules.targetPoints = 22
  const before = structuredClone(content), prompt = cardPrompt(content)
  for (const text of ['"petals"', '"Petals"', '"seedlings"', '"targetPoints": 22', '"permanentResource"', '"relationships"', '"achievements"', '"schemaVersion": 2', '"minimum": 0', "Omit art", "400 cards"]) expect(prompt).toContain(text)
  expect(prompt).not.toMatch(/basketball/i)
  const example = sampleCards(content)
  expect(example).toHaveLength(3)
  expect(example.every(c => Card.safeParse(c).success)).toBe(true)
  expect(example[0]).toMatchObject({ group: "seedlings", cost: { petals: 4 } })
  expect(content).toEqual(before)
  content.pack.resourceKinds[0].label = "Flowers"
  expect(cardPrompt(content)).toContain('"Flowers"')
})
it("imports a small batch into an incomplete draft without weakening publish validation", () => {
  const content = blankPack("garden", "Garden"), before = structuredClone(content)
  const result = importCards(JSON.stringify(sampleCards(content).slice(0, 1)), "cards.json", content)
  expect(result.added).toBe(1)
  expect(result.replaced).toBe(0)
  expect(DraftSchema.safeParse(result.candidate).success).toBe(true)
  expect(contentIssues(result.candidate).length).toBeGreaterThan(0)
  expect(content).toEqual(before)
})
it("reports row and field errors, malformed input and duplicates without mutating the draft", () => {
  const content = blankPack("garden", "Garden"), before = structuredClone(content)
  const header = "id,group,name,permanentResource,points,cost.resource-1"
  expect(() => importCards(`${header}\na,tier-1,A,resource-1,nope,3`, "cards.csv", content)).toThrow("CSV row 2 (points): Enter a whole number")
  expect(() => importCards(`${header}\na,tier-1,A,resource-1,,3`, "cards.csv", content)).toThrow("CSV row 2 (points)")
  expect(() => importCards(`${header}\na,tier-1,A,resource-1,0,3\na,tier-1,B,resource-1,0,3`, "cards.csv", content)).toThrow('CSV row 3: Duplicate card ID "a"')
  expect(() => importCards("id,name\na,A", "cards.csv", content)).toThrow("Add these CSV columns")
  expect(() => importCards("```json\n[]", "cards.json", content)).toThrow("without Markdown fences")
  expect(() => importCards("null", "cards.json", content)).toThrow("Batch:")
  expect(content).toEqual(before)
})
it("preserves existing IDs, artwork and metadata and identifies replacements for review", () => {
  const content = starfallContent(), card = content.pack.cards[0]
  card.art = { src: "/art/original.webp", creator: "Test artist", license: "Original", attribution: "Test credit" }
  card.meta = { origin: "Test garden" }
  const { art: _art, meta: _meta, ...row } = card
  const result = importCards(JSON.stringify([{ ...row, name: "Revised original" }]), "cards.json", content)
  expect(result.replacedIds).toEqual([card.id])
  expect(result.importedIds).toEqual([card.id])
  expect(result.candidate.pack.cards[0]).toMatchObject({ id: card.id, art: card.art, meta: card.meta, name: "Revised original" })
  expect(content.pack.cards[0].name).not.toBe("Revised original")
  expect(result.candidate.pack.relationships).toEqual(content.pack.relationships)
  expect(contentIssues(result.candidate)).toEqual([])
})
