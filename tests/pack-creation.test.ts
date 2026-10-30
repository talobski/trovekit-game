import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { ContentStore } from "../server/content-store"
import { Id } from "../src/engine/schema"
import { newPackId } from "../src/shared/pack-id"
import { starfallContent } from "./fixtures/starfall"

it("generates bounded IDs from names, accents, punctuation and non-Latin text", () => {
  for (const [name, id] of [["  Anime Legends  ", "anime-legends"], ["Café's & Cards!", "cafes-cards"], ["星の物語", "pack"], ["!!!", "pack"], ["A".repeat(48), "a".repeat(48)]]) {
    expect(newPackId(name, [])).toBe(id)
    const duplicate = newPackId(name, [id])
    expect(duplicate).not.toBe(id)
    expect(Id.safeParse(duplicate).success).toBe(true)
  }
  expect(newPackId("Anime Legends", ["anime-legends", "anime-legends-2"])).toBe("anime-legends-3")
})
it("creates stable drafts without overwriting drafts, archived or published IDs", () => {
  const dir = mkdtempSync(join(tmpdir(), "trovekit-create-")), store = new ContentStore(dir)
  expect(store.publish(starfallContent(), "fixture").ok).toBe(true)
  const name = starfallContent().pack.name
  const one = store.createDraft(name), two = store.createDraft(name)
  expect(one.ok && two.ok).toBe(true)
  if (!one.ok || !two.ok) return
  expect(one.content.pack.id).not.toBe(starfallContent().pack.id)
  expect(two.content.pack.id).not.toBe(one.content.pack.id)
  expect(store.archive(one.content.pack.id, true)).toBe(true)
  const three = store.createDraft(name)
  expect(three.ok && three.content.pack.id).not.toBe(one.content.pack.id)
  const id = two.content.pack.id
  two.content.pack.name = "Renamed"
  expect(store.saveDraft(two.content, two.revision).ok).toBe(true)
  expect(new ContentStore(dir).head(id)?.content.pack).toMatchObject({ id, name: "Renamed", cards: [] })
  expect(store.saveDraft(two.content, null).ok).toBe(false)
  expect(store.publish(two.content, "incomplete").ok).toBe(false)
})
it("rejects empty, long and unsafe names before writing and preserves duplicated content", () => {
  const store = new ContentStore(mkdtempSync(join(tmpdir(), "trovekit-create-")))
  for (const name of ["", "   ", "x".repeat(49), "<bad>", "a\u0000b", null, 42]) expect(store.createDraft(name).ok).toBe(false)
  expect(store.catalog()).toEqual([])
  const source = starfallContent(), before = structuredClone(source)
  const result = store.createDraft("Another theme", source)
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.content.pack.cards).toEqual(source.pack.cards)
  expect(result.content.rules).toEqual(source.rules)
  expect(result.content.pack.id).toBe("another-theme")
  expect(source).toEqual(before)
})
