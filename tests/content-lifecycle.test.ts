import * as fs from "node:fs"
import { mkdtempSync, readFileSync, readdirSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createAdminServer } from "../server/admin-server"
import { ContentStore } from "../server/content-store"
import { blankPack } from "../src/admin/import-model"
import { defaultState, duplicateVersion, packStatuses } from "../src/admin/lifecycle"
import type { Content, PackSummary, VersionSummary } from "../src/shared/content"
import { starfallContent } from "./fixtures/starfall"

/*
 * Drafts, published versions and the default are
 * three independent things. Publishing never changes the default; Make default
 * never touches drafts, archiving or the latest-published pointer; and a draft
 * is only ever replaced over the revision the editor loaded.
 */

// Lets a test make chosen renames (every atomic write ends in one) fail, to check a failed save changes nothing.
const failRename = vi.hoisted(() => ({ when: null as null | ((to: string) => boolean) }))
vi.mock("node:fs", async (original) => {
  const real = await original<typeof import("node:fs")>()
  return {
    ...real,
    renameSync: (from: fs.PathLike, to: fs.PathLike) => {
      if (failRename.when?.(String(to))) throw Object.assign(new Error("disk full"), { code: "ENOSPC" })
      return real.renameSync(from, to)
    },
  }
})
const failing = (when: (to: string) => boolean, run: () => void) => {
  failRename.when = when
  try { run() } finally { failRename.when = null }
}

const newStore = () => {
  const dir = mkdtempSync(join(tmpdir(), "trovekit-lifecycle-"))
  return { dir, store: new ContentStore(dir) }
}
const edited = (content: Content, points: number) => {
  const c = structuredClone(content)
  c.rules.targetPoints = points
  return c
}
const publish = (store: ContentStore, content: Content, note = "v") => {
  const result = store.publish(content, note)
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result.version.id
}
/** Every file in the content folder, with the bytes of the JSON ones (temporary files would show up too). */
const snapshot = (dir: string) => readdirSync(join(dir, "content")).sort().map((f) => [f, f.endsWith(".json") ? readFileSync(join(dir, "content", f), "utf8") : ""])
const versionFiles = (dir: string) =>
  Object.fromEntries(readdirSync(join(dir, "content", "versions")).map((f) => [f, readFileSync(join(dir, "content", "versions", f), "utf8")]))

describe("publishing is separate from choosing the default", () => {
  it("publishing creates an immutable latest version and never sets or moves the default", () => {
    const { store } = newStore()
    const v1 = publish(store, starfallContent())
    expect(store.active()).toBeNull()
    expect(store.catalog()).toEqual([{ id: "starfall", name: "Starfall Academy", archived: false, published: v1, draft: false }])
    expect(store.activate(v1)).toEqual({ ok: true })
    const v2 = publish(store, edited(starfallContent(), 18))
    expect(store.active()?.id).toBe(v1)
    expect(store.catalog()[0].published).toBe(v2)
    expect(store.list().versions.map((v) => [v.id, v.packId])).toEqual([[v2, "starfall"], [v1, "starfall"]])
  })

  it("making an older version the default (rollback) leaves the latest-published pointer alone", () => {
    const { dir, store } = newStore()
    const v1 = publish(store, starfallContent())
    const v2 = publish(store, edited(starfallContent(), 18))
    const files = versionFiles(dir)
    expect(store.activate(v2).ok).toBe(true)
    expect(store.activate(v1).ok).toBe(true)
    expect(store.active()?.id).toBe(v1)
    expect(store.catalog()[0].published).toBe(v2)
    expect(store.head("starfall")).toMatchObject({ source: "published", versionId: v2 })
    expect(versionFiles(dir)).toEqual(files)
  })

  it("never silently unarchives: archived packs cannot become the default, and publishing keeps them archived", () => {
    const { store } = newStore()
    const v1 = publish(store, starfallContent())
    expect(store.archive("starfall", true)).toBe(true)
    expect(store.activate(v1)).toEqual({ ok: false, code: "ARCHIVED" })
    publish(store, edited(starfallContent(), 18))
    expect(store.catalog()[0].archived).toBe(true)
    expect(store.active()).toBeNull()
    expect(store.activate("v99-nothing")).toEqual({ ok: false, code: "NOT_FOUND" })
  })

  it("reads versions published before pack ids were recorded", () => {
    const { dir, store } = newStore()
    publish(store, starfallContent())
    const path = join(dir, "content", "index.json")
    const index = JSON.parse(readFileSync(path, "utf8"))
    delete index.versions[0].packId
    fs.writeFileSync(path, JSON.stringify(index))
    expect(new ContentStore(dir).list().versions[0].packId).toBe("starfall")
  })
})

describe("drafts survive publishing and Make default", () => {
  it("making the same, another or an older version the default neither hides nor changes a draft", () => {
    const { store } = newStore()
    const v1 = publish(store, starfallContent())
    const v2 = publish(store, edited(starfallContent(), 18))
    const nebula = publish(store, { ...starfallContent(), pack: { ...starfallContent().pack, id: "nebula", name: "Nebula" } })
    const draft = edited(starfallContent(), 20)
    const saved = store.saveDraft(draft, store.head("starfall")!.revision)
    expect(saved.ok).toBe(true)
    for (const id of [v2, v2, v1, nebula, v2]) {
      expect(store.activate(id).ok).toBe(true)
      expect(store.catalog().find((p) => p.id === "starfall")).toMatchObject({ draft: true, published: v2, archived: false })
      expect(store.head("starfall")).toMatchObject({ source: "draft", content: draft, revision: saved.ok && saved.revision })
    }
  })

  it("publishing clears the draft only when it is exactly the content published", () => {
    const { store } = newStore()
    publish(store, starfallContent())
    const draft = edited(starfallContent(), 20)
    expect(store.saveDraft(draft, store.head("starfall")!.revision).ok).toBe(true)
    // Different content (another tab, or unsaved editor changes): the draft stays.
    const other = store.publish(edited(starfallContent(), 19), "other")
    expect(other.ok && other.draftCleared).toBe(false)
    expect(store.head("starfall")).toMatchObject({ source: "draft", content: draft })
    // Exactly the draft: cleared, and the editor now opens that version.
    const exact = store.publish(draft, "exact")
    expect(exact.ok && exact.draftCleared).toBe(true)
    expect(store.catalog()[0].draft).toBe(false)
    expect(store.head("starfall")).toMatchObject({ source: "published", content: draft, versionId: exact.ok && exact.version.id })
  })

  it("keeps one draft per pack, and an archived pack keeps its draft", () => {
    const { dir, store } = newStore()
    const created = store.createDraft("Nebula")
    if (!created.ok) throw new Error("create failed")
    const next = structuredClone(created.content)
    next.pack.name = "Nebula two"
    expect(store.saveDraft(next, created.revision).ok).toBe(true)
    expect(readdirSync(join(dir, "content")).filter((f) => f.startsWith("draft-"))).toEqual(["draft-nebula.json"])
    expect(store.archive("nebula", true)).toBe(true)
    expect(store.head("nebula")?.content.pack.name).toBe("Nebula two")
  })
})

describe("stale draft protection", () => {
  it("a second tab cannot overwrite a newer draft, and gets the current revision back", () => {
    const { store } = newStore()
    publish(store, starfallContent())
    const loaded = store.head("starfall")!.revision // both tabs open the same content
    const first = store.saveDraft(edited(starfallContent(), 20), loaded)
    expect(first.ok).toBe(true)
    const second = store.saveDraft(edited(starfallContent(), 12), loaded)
    expect(second).toEqual({ ok: false, conflict: true, revision: first.ok && first.revision })
    expect(store.head("starfall")?.content.rules.targetPoints).toBe(20)
    // Publishing over a stale revision is refused too, and publishes nothing.
    expect(store.publish(edited(starfallContent(), 12), "stale", loaded)).toMatchObject({ ok: false, conflict: true })
    expect(store.list().versions).toHaveLength(1)
    // After reloading, the same tab saves normally.
    expect(store.saveDraft(edited(starfallContent(), 12), store.head("starfall")!.revision).ok).toBe(true)
  })

  it("a tab whose draft was published exactly elsewhere can keep saving: its base content is unchanged", () => {
    const { store } = newStore()
    publish(store, starfallContent())
    const draft = edited(starfallContent(), 20)
    const saved = store.saveDraft(draft, store.head("starfall")!.revision)
    if (!saved.ok) throw new Error("save failed")
    expect(store.publish(draft, "from tab B", saved.revision)).toMatchObject({ ok: true, draftCleared: true })
    expect(store.saveDraft(edited(starfallContent(), 21), saved.revision).ok).toBe(true)
  })

  it("a new pack cannot be created over an existing ID, by save or publish", () => {
    const { store } = newStore()
    publish(store, starfallContent())
    expect(store.saveDraft(starfallContent(), null)).toMatchObject({ ok: false, issues: [{ path: "pack.id" }] })
    expect(store.publish(starfallContent(), "new", null)).toMatchObject({ ok: false, conflict: true })
    expect(store.saveDraft(blankPack("missing", "Missing"), "0".repeat(64))).toMatchObject({ ok: false, conflict: true, revision: null })
  })

  it("a save that fails part-way leaves the previous draft and index exactly as they were", () => {
    const { dir, store } = newStore()
    publish(store, starfallContent())
    const draft = edited(starfallContent(), 20)
    const saved = store.saveDraft(draft, store.head("starfall")!.revision)
    if (!saved.ok) throw new Error("save failed")
    const before = snapshot(dir)
    failing((to) => to.endsWith("index.json"), () => {
      expect(() => store.saveDraft(edited(starfallContent(), 12), saved.revision)).toThrow("disk full")
      expect(() => store.saveDraft(blankPack("fresh", "Fresh"), null)).toThrow("disk full")
    })
    expect(snapshot(dir)).toEqual(before)
    expect(store.head("starfall")).toMatchObject({ source: "draft", content: draft, revision: saved.revision })
    expect(store.head("fresh")).toBeNull()
  })

  it("if moving the new draft into place fails, the previous draft is untouched and the index is put back", () => {
    const { dir, store } = newStore()
    publish(store, starfallContent())
    const draft = edited(starfallContent(), 20)
    const saved = store.saveDraft(draft, store.head("starfall")!.revision)
    if (!saved.ok) throw new Error("save failed")
    const before = snapshot(dir)
    failing((to) => /draft-[a-z0-9-]+\.json$/.test(to), () => {
      expect(() => store.saveDraft(edited(starfallContent(), 12), saved.revision)).toThrow("disk full")
      expect(() => store.saveDraft(blankPack("fresh", "Fresh"), null)).toThrow("disk full")
    })
    expect(snapshot(dir)).toEqual(before)
    expect(store.head("starfall")).toMatchObject({ source: "draft", content: draft, revision: saved.revision })
  })

  it("if putting the index back fails too, the previous draft is still intact and no empty pack appears", () => {
    const { dir, store } = newStore()
    publish(store, starfallContent())
    const draft = edited(starfallContent(), 20)
    const saved = store.saveDraft(draft, store.head("starfall")!.revision)
    if (!saved.ok) throw new Error("save failed")
    const draftBytes = readFileSync(join(dir, "content", "draft-starfall.json"), "utf8")
    // The draft rename fails, then every later index write (the restore) fails as well.
    let indexWrites = 0
    const restoreFails = (to: string) => /draft-[a-z0-9-]+\.json$/.test(to) || (to.endsWith("index.json") && ++indexWrites > 1)
    failing(restoreFails, () => expect(() => store.saveDraft(edited(starfallContent(), 12), saved.revision)).toThrow("disk full"))
    indexWrites = 0
    failing(restoreFails, () => expect(() => store.saveDraft(blankPack("fresh", "Fresh"), null)).toThrow("disk full"))
    expect(readFileSync(join(dir, "content", "draft-starfall.json"), "utf8")).toBe(draftBytes)
    expect(readdirSync(join(dir, "content")).filter((f) => f.endsWith(".tmp"))).toEqual([])
    const reopened = new ContentStore(dir)
    expect(reopened.head("starfall")).toMatchObject({ source: "draft", content: draft, revision: saved.revision })
    expect(reopened.head("fresh")).toBeNull()
    expect(reopened.catalog().map((p) => p.id)).toEqual(["starfall"])
    // The library keeps working normally afterwards.
    expect(reopened.saveDraft(blankPack("fresh", "Fresh"), null).ok).toBe(true)
    expect(reopened.saveDraft(edited(starfallContent(), 12), saved.revision).ok).toBe(true)
  })
})

describe("admin API", () => {
  const closers: (() => void)[] = []
  afterEach(() => closers.splice(0).forEach((c) => c()))

  async function startAdmin() {
    const dataDir = mkdtempSync(join(tmpdir(), "trovekit-lifecycle-api-"))
    const probe = createAdminServer({ dataDir, port: 0 })
    await new Promise<void>((r) => probe.server.listen(0, "127.0.0.1", r))
    const port = (probe.server.address() as AddressInfo).port
    await new Promise<void>((r) => probe.server.close(() => r()))
    const admin = createAdminServer({ dataDir, port })
    await new Promise<void>((r) => admin.listen(r))
    closers.push(() => admin.server.close())
    const post = (path: string, body: unknown) =>
      fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { "x-trovekit-admin": "1", "content-type": "application/json" }, body: JSON.stringify(body) })
    const get = (path: string) => fetch(`http://127.0.0.1:${port}${path}`, { headers: { "x-trovekit-admin": "1" } })
    return { admin: Object.assign(admin, { dataDir }), post, get }
  }

  it("publishes without activating, refuses the legacy activate flag, and makes the default separately", async () => {
    const { admin, post } = await startAdmin()
    const legacy = await post("/admin-api/versions", { content: starfallContent(), note: "old client", activate: true })
    expect([legacy.status, (await legacy.json()).code]).toEqual([400, "ACTIVATE_SEPARATELY"])
    expect(admin.store.list().versions).toHaveLength(0)
    const published = await post("/admin-api/versions", { content: starfallContent(), note: "first", activate: false })
    expect(published.status).toBe(201)
    const { version } = await published.json()
    expect(admin.store.active()).toBeNull()
    expect((await post("/admin-api/active", { id: version.id })).status).toBe(200)
    expect(admin.store.active()?.id).toBe(version.id)
    expect(admin.store.archive("starfall", true)).toBe(false) // the default's pack cannot be archived
  })

  it("never serves or activates an altered version file", async () => {
    const { admin, post, get } = await startAdmin()
    const v = admin.store.publish(starfallContent(), "first")
    if (!v.ok) throw new Error("publish failed")
    expect((await get(`/admin-api/versions/${v.version.id}`)).status).toBe(200)
    const file = join(admin.dataDir, "content", "versions", `${v.version.id}.json`)
    fs.writeFileSync(file, JSON.stringify(edited(starfallContent(), 99)))
    expect((await get(`/admin-api/versions/${v.version.id}`)).status).toBe(404)
    expect((await post("/admin-api/active", { id: v.version.id })).status).toBe(404)
    expect((await get("/admin-api/content")).status).toBe(200)
  })

  it("refuses Make default for an archived pack without unarchiving it", async () => {
    const { admin, post } = await startAdmin()
    const v = admin.store.publish(starfallContent(), "first")
    if (!v.ok) throw new Error("publish failed")
    admin.store.archive("starfall", true)
    const res = await post("/admin-api/active", { id: v.version.id })
    expect([res.status, (await res.json()).code]).toEqual([409, "PACK_ARCHIVED"])
    expect(admin.store.catalog()[0].archived).toBe(true)
  })

  it("opens a pack's head with its revision and answers stale saves with 409 and the current revision", async () => {
    const { post, get } = await startAdmin()
    expect((await post("/admin-api/versions", { content: starfallContent(), note: "first" })).status).toBe(201)
    const head = await (await get("/admin-api/drafts/starfall")).json()
    expect(head).toMatchObject({ source: "published", content: starfallContent() })
    const tabA = await post("/admin-api/drafts", { content: edited(starfallContent(), 20), revision: head.revision })
    expect(tabA.status).toBe(200)
    const { revision } = await tabA.json()
    const tabB = await post("/admin-api/drafts", { content: edited(starfallContent(), 12), revision: head.revision })
    expect(tabB.status).toBe(409)
    expect(await tabB.json()).toMatchObject({ code: "DRAFT_CONFLICT", revision })
    const stalePublish = await post("/admin-api/versions", { content: edited(starfallContent(), 12), note: "stale", revision: head.revision })
    expect(stalePublish.status).toBe(409)
    const missing = await post("/admin-api/drafts", { content: edited(starfallContent(), 12) })
    expect([missing.status, (await missing.json()).code]).toEqual([400, "REVISION_REQUIRED"])
    expect((await (await get("/admin-api/drafts/starfall")).json()).content.rules.targetPoints).toBe(20)
  })
})

describe("imports that reuse an existing pack ID", () => {
  it("Create separate pack gives the import a new ID and leaves the existing pack untouched", () => {
    const { dir, store } = newStore()
    const v1 = publish(store, starfallContent())
    const draft = edited(starfallContent(), 20)
    expect(store.saveDraft(draft, store.head("starfall")!.revision).ok).toBe(true)
    const before = { head: store.head("starfall"), versions: versionFiles(dir) }
    const imported = edited(starfallContent(), 9)
    const separate = store.createDraft(imported.pack.name, imported)
    expect(separate.ok && separate.content.pack.id).toBe("starfall-academy")
    expect(separate.ok && separate.content.rules.targetPoints).toBe(9)
    expect(store.head("starfall")).toEqual(before.head)
    expect(versionFiles(dir)).toEqual(before.versions)
    expect(store.catalog().find((p) => p.id === "starfall")?.published).toBe(v1)
  })

  it("Update existing pack saves over the pack's current revision, and only then", () => {
    const { store } = newStore()
    publish(store, starfallContent())
    const imported = edited(starfallContent(), 9)
    // Saving an import as if it were a new pack is refused rather than overwriting.
    expect(store.saveDraft(imported, null)).toMatchObject({ ok: false, issues: [{ path: "pack.id" }] })
    expect(store.saveDraft(imported, store.head("starfall")!.revision).ok).toBe(true)
    expect(store.head("starfall")?.content.rules.targetPoints).toBe(9)
  })
})

describe("admin status wording", () => {
  const pack = (id: string, published: string | null, extra: Partial<PackSummary> = {}): PackSummary => ({ id, name: id, archived: false, published, draft: false, ...extra })
  const version = (id: string, packId: string, packVersion: string): VersionSummary => ({ id, packId, packVersion, packName: packId, createdAt: "2026-10-11T00:00:00Z", note: "", hash: "", targetPoints: 15 })
  const versions = [version("v3", "a", "1.2.0"), version("v2", "b", "1.0.0"), version("v1", "a", "1.0.0")]

  it("separates draft, latest published and default per pack", () => {
    const [a, b] = packStatuses([pack("a", "v3", { draft: true }), pack("b", "v2")], versions, "v1")
    expect([a.latest?.id, a.defaultVersion?.id, a.pack.draft, a.versions.map((v) => v.id)]).toEqual(["v3", "v1", true, ["v3", "v1"]])
    expect([b.latest?.id, b.defaultVersion]).toEqual(["v2", null])
  })

  it("never says nothing is published when only the default is missing", () => {
    expect(defaultState([], [], null)).toEqual({ kind: "empty" })
    expect(defaultState([pack("a", null, { draft: true })], [], null)).toEqual({ kind: "unpublished" })
    expect(defaultState([pack("a", "v3")], versions, null)).toEqual({ kind: "no-default" })
    expect(defaultState([pack("a", "v3")], versions, "v3")).toMatchObject({ kind: "default", version: { id: "v3" } })
  })

  it("warns about a repeated version number within the same pack only", () => {
    const content = starfallContent()
    content.pack.id = "a"
    content.pack.version = "1.0.0"
    expect(duplicateVersion(versions, content)?.id).toBe("v1")
    content.pack.version = "1.3.0"
    expect(duplicateVersion(versions, content)).toBeNull()
    content.pack.id = "c"
    content.pack.version = "1.0.0"
    expect(duplicateVersion(versions, content)).toBeNull()
  })
})

describe("private playtesting documentation", () => {
  it("binds the playtest game to this computer only", () => {
    const doc = readFileSync(join(__dirname, "..", "docs", "CONTENT_PACKS.md"), "utf8")
    const section = doc.slice(doc.indexOf("### Test an unreleased version privately"), doc.indexOf("### Admin API behaviour"))
    const commands = section.split("\n").filter((line) => /npm run (dev|admin)/.test(line))
    expect(commands).toHaveLength(2)
    expect(commands.find((line) => line.includes("npm run dev"))).toMatch(/^HOST=127\.0\.0\.1 /)
  })
})
