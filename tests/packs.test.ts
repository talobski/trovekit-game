import { mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { zipSync, strToU8 } from "fflate"
import sharp from "sharp"
import { z } from "zod"
import { expect, it } from "vitest"
import { ContentStore } from "../server/content-store"
import { RoomService } from "../server/rooms"
import { prepareImage, storeImage, assetBytes } from "../server/assets"
import { importBundle, exportBundle } from "../server/bundles"
import { AI_PROMPT, blankPack, importCards } from "../src/admin/import-model"
import { ContentSchema, contentIssues } from "../src/shared/content"
import { createContext, setupGame } from "../src/engine"
import { playBotGame } from "../src/bots"
import { starfallContent } from "./fixtures/starfall"

const dir = () => mkdtempSync(join(tmpdir(), "trovekit-packs-"))
it("creates a blank draft, batch imports 66 fictional cards, publishes, selects, archives and rolls back independently", () => {
  const data = dir(), store = new ContentStore(data), source = starfallContent()
  const draft = blankPack("celestial", "Celestial Academy")
  expect(store.saveDraft(draft, null).ok).toBe(true)
  expect(store.catalog().find(p => p.id === "celestial")?.published).toBeNull()
  expect(store.saveDraft(draft, null).ok).toBe(false)
  const kinds = Object.fromEntries(source.pack.resourceKinds.map((k, i) => [k.id, draft.pack.resourceKinds[i].id]))
  const groups = Object.fromEntries(source.pack.cardGroups.map((g, i) => [g.id, draft.pack.cardGroups[i].id]))
  const cards = source.pack.cards.map((c, i) => ({ ...c, id: `hero-${i}`, name: `Celestial Hero ${i}`, shortName: `Hero ${i}`, group: groups[c.group], permanentResource: kinds[c.permanentResource], cost: Object.fromEntries(Object.entries(c.cost).map(([k, v]) => [kinds[k], v])) }))
  const imported = importCards(JSON.stringify(cards), "cards.json", draft)
  expect(imported.added).toBe(66)
  imported.candidate.pack.relationships = [{ id: "allies", label: "Original allies", cardIds: ["hero-0", "hero-1"], note: "Original fictional pair", source: "Original fiction" }]
  expect(contentIssues(imported.candidate)).toEqual([])
  const saved = store.publish(imported.candidate, "Published")
  expect(saved.ok).toBe(true)
  if (!saved.ok) return
  expect(store.catalog().find(p => p.id === "celestial")?.published).toBe(saved.version.id)
  expect(store.activate(saved.version.id).ok).toBe(true)
  const rooms = new RoomService(data, store)
  const host = rooms.create("Host", "Anime game")
  rooms.join(host.code, "Guest"); rooms.start(host.code, host.token)
  const snapshot = structuredClone(rooms.getRoom(host.code)!.snapshot)
  expect(snapshot?.content.pack.id).toBe("celestial")
  const ctx = createContext(imported.candidate.pack, imported.candidate.rules)
  const game = playBotGame(ctx, setupGame(ctx, [{ id: "a", name: "A" }, { id: "b", name: "B" }], "fiction"), "fiction-bots")
  expect(game.status).toBe("finished")
  imported.candidate.pack.name = "Academy revised"
  const next = store.publish(imported.candidate, "Revised")
  expect(next.ok).toBe(true)
  expect(store.archive("celestial", true)).toBe(false) // the default's pack stays available
  const other = store.publish({ ...source, pack: { ...source.pack, id: "other" } }, "Other pack")
  expect(other.ok && store.activate(other.version.id).ok).toBe(true)
  expect(store.archive("celestial", true)).toBe(true)
  expect(rooms.getRoom(host.code)!.snapshot).toEqual(snapshot)
  expect(store.activate(saved.version.id)).toEqual({ ok: false, code: "ARCHIVED" })
  expect(store.archive("celestial", false)).toBe(true)
  expect(store.activate(saved.version.id)).toEqual({ ok: true })
  expect(store.active()?.content.pack.name).toBe("Celestial Academy")
  rooms.dispose()
  const restored = new RoomService(data, new ContentStore(data))
  expect(restored.getRoom(host.code)!.snapshot).toEqual(snapshot)
  restored.dispose()
})
it("rejects duplicate cards, broken references, unreachable predicates, malformed CSV and invalid content without publishing", () => {
  const store = new ContentStore(dir()), original = starfallContent(), before = store.list()
  expect(() => importCards(JSON.stringify([original.pack.cards[0], original.pack.cards[0]]), "cards.json", original)).toThrow("Duplicate")
  expect(() => importCards('id,name\na,"broken', "cards.csv", original)).toThrow()
  const bad = structuredClone(original); bad.pack.relationships[0].cardIds[0] = "missing"
  expect(store.publish(bad, "invalid").ok).toBe(false)
  bad.pack.achievements[0].requirement = { type: "cardCount", min: 100 }
  expect(contentIssues(bad).some(i => i.message.includes("Needs 100"))).toBe(true)
  expect(contentIssues({ pack: null }).length).toBeGreaterThan(0)
  expect(store.list()).toEqual(before)
  const csv = `id,group,name,permanentResource,points,cost.tide\nnew-id,first-years,"Hero, One",stone,0,3`
  expect(importCards(csv, "cards.csv", original).candidate.pack.cards.at(-1)?.name).toBe("Hero, One")
  expect(z.toJSONSchema(ContentSchema, { unrepresentable: "any" }).properties).toHaveProperty("pack")
  expect(AI_PROMPT).toContain("data-only")
})
it("bundles round-trip images and attribution, and reject unsafe ZIPs without saving content", async () => {
  const from = dir(), to = dir(), content = starfallContent()
  const image = await prepareImage(await sharp({ create: { width: 100, height: 100, channels: 3, background: "blue" } }).png().toBuffer(), "card.png")
  storeImage(from, image)
  content.pack.cards[0].art = { src: image.src, license: "Original", creator: "Test", attribution: "Original test image" }
  const result = await importBundle(to, Buffer.from(exportBundle(from, content)))
  expect(result).toEqual(content)
  expect(assetBytes(to, image.src)).toEqual(image.bytes)
  for (const path of ["../escape.webp", "/absolute.webp", "assets/script.svg"]) {
    await expect(importBundle(to, Buffer.from(zipSync({ [path]: strToU8("bad") })))).rejects.toThrow()
  }
  // Importing a bundle only returns content for review: nothing is saved.
  expect(new ContentStore(to).list().versions).toHaveLength(0)
})
