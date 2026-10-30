import { z } from "zod"
import { Id, Text } from "../src/engine/schema.ts"
import { blankPack } from "../content/index.ts"
import { newPackId } from "../src/shared/pack-id.ts"
import { createHash, randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { canonicalJson, type Issue } from "../src/engine/index.ts"
import { DraftSchema, validateContent, type Content, type PackHead, type PackSummary, type VersionSummary } from "../src/shared/content.ts"

export { validateContent, type Content, type PackHead, type PackSummary, type VersionSummary }

/*
 * Versioned content on disk. A new installation has an empty library: there is
 * no built-in pack and nothing is installed automatically.
 *
 * Each pack has at most one draft (`draft-<id>.json`) and any number of
 * published versions (immutable files in `versions/`). `index.json` keeps two
 * separate pointers: each pack's latest published version, and the single
 * default version new rooms use (`active`). Publishing moves only the first;
 * Make default moves only the second. Neither touches drafts or archiving.
 * Rooms pin their version when created, so changing the default never touches
 * a waiting or live room.
 */

interface IndexFile {
  packs?: Record<string, PackSummary>
  active: string | null
  versions: (Omit<VersionSummary, "packId"> & { packId?: string })[]
}

type Conflict = { ok: false; conflict: true; revision: string | null }
export type DraftResult = { ok: true; revision: string } | { ok: false; issues: Issue[] } | Conflict
export type PublishResult = { ok: true; version: VersionSummary; draftCleared: boolean } | { ok: false; issues: Issue[] } | Conflict
export type ActivateResult = { ok: true } | { ok: false; code: "NOT_FOUND" | "ARCHIVED" }

const versionSchema = z.object({ id: z.string().regex(/^[a-z0-9-]{1,64}$/), createdAt: z.string(), note: z.string(), hash: z.string(), packId: Id.optional(), packName: z.string(), packVersion: z.string(), targetPoints: z.number() })
const indexSchema = z.object({ active: z.string().nullable(), versions: z.array(versionSchema), packs: z.record(Id, z.object({ id: Id, name: z.string(), archived: z.boolean(), published: z.string().nullable(), draft: z.boolean() })).optional() })

export function contentHash(content: Content): string {
  return createHash("sha256").update(canonicalJson(content)).digest("hex")
}

export function writeJsonAtomic(path: string, value: unknown) {
  const tmp = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(value), { flag: "wx", mode: 0o600 })
    renameSync(tmp, path)
  } finally { rmSync(tmp, { force: true }) }
}

const issuesOf = (error: z.ZodError, path?: string): Issue[] => error.issues.map(i => ({ path: path ?? i.path.join("."), message: i.message }))

export class ContentStore {
  private readonly dir: string
  private readonly versionsDir: string
  private readonly indexPath: string

  constructor(dataDir: string) {
    this.dir = join(dataDir, "content")
    this.versionsDir = join(this.dir, "versions")
    this.indexPath = join(this.dir, "index.json")
    mkdirSync(this.versionsDir, { recursive: true })
    this.readIndex() // Fail clearly on a corrupt index; never silently replace it.
  }

  private readIndex(): IndexFile {
    if (!existsSync(this.indexPath)) return { active: null, versions: [] }
    try {
      const raw = JSON.parse(readFileSync(this.indexPath, "utf8"))
      return indexSchema.parse({ ...raw, active: raw.active ?? null })
    } catch { throw new Error("Content index is invalid; inspect or restore data/content/index.json before starting") }
  }

  private draftPath(id: string) {
    return join(this.dir, `draft-${id}.json`)
  }

  get healthy(): boolean {
    try { const index = this.readIndex(); return !index.active || !!this.active() }
    catch { return false }
  }

  /** Every published version, newest first. */
  list(): { active: string | null; versions: VersionSummary[] } {
    const index = this.readIndex()
    // Versions published before pack ids were recorded get theirs from the file.
    const versions = index.versions.map(v => ({ ...v, packId: v.packId ?? this.storedPackId(v.id) ?? "" }))
    return { active: index.active, versions: versions.reverse() }
  }

  /** A version file's parsed JSON, or null when it is missing, unreadable or not JSON. Unverified. */
  private readVersionFile(id: string): unknown {
    if (!/^[a-z0-9-]{1,64}$/.test(id)) return null
    try { return JSON.parse(readFileSync(join(this.versionsDir, `${id}.json`), "utf8")) }
    catch { return null }
  }

  private storedPackId(id: string): string | null {
    const packId = (this.readVersionFile(id) as { pack?: { id?: unknown } } | null)?.pack?.id
    return Id.safeParse(packId).success ? packId as string : null
  }

  /**
   * A published version's content, verified: it must be listed in the index,
   * readable, valid, and exactly the content whose hash was recorded when it
   * was published. Altered, orphaned, missing or malformed files give null.
   */
  get(id: string): Content | null {
    const recorded = this.readIndex().versions.find(v => v.id === id)
    const stored = recorded ? this.readVersionFile(id) : null
    const checked = stored ? validateContent(stored) : null
    return checked?.ok && contentHash(checked.content) === recorded!.hash ? checked.content : null
  }

  /** The verified published version `id`, or null. */
  version(id: string): { id: string; content: Content; hash: string } | null {
    const content = this.get(id)
    return content ? { id, content, hash: contentHash(content) } : null
  }

  /** The default version for new rooms, or null when none is set. Never falls back to other content. */
  active(): { id: string; content: Content; hash: string } | null {
    const { active } = this.readIndex()
    return active ? this.version(active) : null
  }

  /** Every pack in the library (published or draft); empty for a new installation. */
  catalog(): PackSummary[] {
    const index = this.readIndex()
    const packs = new Map<string, PackSummary>()
    for (const version of index.versions) {
      const id = version.packId ?? this.storedPackId(version.id)
      if (id) packs.set(id, { id, name: version.packName, archived: false, published: version.id, draft: false })
    }
    for (const item of Object.values(index.packs ?? {})) {
      const pack = { ...item, draft: item.draft && existsSync(this.draftPath(item.id)) }
      // A record left by a save that failed part-way, with nothing behind it.
      if (pack.draft || pack.published) packs.set(item.id, pack)
    }
    return [...packs.values()]
  }

  /** What the editor opens: the pack's draft, or else its latest published version. */
  head(id: string): PackHead | null {
    if (!Id.safeParse(id).success) return null
    const pack = this.catalog().find(p => p.id === id)
    if (!pack) return null
    if (pack.draft) {
      const content = JSON.parse(readFileSync(this.draftPath(id), "utf8")) as Content
      return { content, revision: contentHash(content), source: "draft", versionId: null }
    }
    const content = pack.published ? this.get(pack.published) : null
    return content ? { content, revision: contentHash(content), source: "published", versionId: pack.published } : null
  }

  private conflict(id: string, expected: string | null): Conflict | null {
    const current = this.head(id)?.revision ?? null
    return current === expected ? null : { ok: false, conflict: true, revision: current }
  }

  /**
   * Save a pack's one draft. `base` is the revision the editor started from,
   * or null for a pack that does not exist yet. Anything else saved since
   * (another tab, a publish of different content) is a conflict, never
   * overwritten.
   */
  saveDraft(input: unknown, base: string | null): DraftResult {
    const parsed = DraftSchema.safeParse(input)
    if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error) }
    const content = parsed.data
    const existing = this.catalog().find(p => p.id === content.pack.id)
    if (base === null && existing) return { ok: false, issues: [{ path: "pack.id", message: "A pack with this ID already exists" }] }
    const conflict = base === null ? null : this.conflict(content.pack.id, base)
    if (conflict) return conflict
    // The previous draft is never rewritten: the new one is staged beside it and
    // renamed into place (atomically) only after the index is saved. Any failure
    // leaves the previous draft byte-for-byte intact.
    const path = this.draftPath(content.pack.id)
    const staged = `${path}.${randomUUID()}.tmp`
    try {
      writeFileSync(staged, JSON.stringify(content), { flag: "wx", mode: 0o600 })
      const before = this.readIndex()
      const index = structuredClone(before)
      index.packs = { ...index.packs, [content.pack.id]: { id: content.pack.id, name: content.pack.name, archived: existing?.archived ?? false, published: existing?.published ?? null, draft: true } }
      writeJsonAtomic(this.indexPath, index)
      try { renameSync(staged, path) }
      catch (e) {
        // Best effort: put the index back. If that fails too, the index names a
        // draft whose file is unchanged (or absent, which catalog() ignores).
        try { writeJsonAtomic(this.indexPath, before) } catch { /* see above */ }
        throw e
      }
    } finally { rmSync(staged, { force: true }) }
    return { ok: true, revision: contentHash(content as Content) }
  }

  /** Allocate and save synchronously, so simultaneous admin requests cannot reuse an ID. */
  createDraft(name: unknown, template?: unknown): { ok: true; content: Content; revision: string } | { ok: false; issues: Issue[] } {
    const parsed = Text(48).safeParse(name)
    if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error, "pack.name") }
    const id = newPackId(parsed.data, this.catalog().map(p => p.id))
    let content = blankPack(id, parsed.data)
    if (template !== undefined) {
      const checked = DraftSchema.safeParse(template)
      if (!checked.success) return { ok: false, issues: issuesOf(checked.error) }
      content = { ...checked.data, pack: { ...checked.data.pack, id, name: parsed.data, version: "1.0.0" } }
    }
    const saved = this.saveDraft(content, null)
    if (saved.ok) return { ok: true, content, revision: saved.revision }
    return "issues" in saved ? saved : { ok: false, issues: [{ path: "pack.id", message: "A pack with this ID already exists" }] }
  }

  /** Archiving hides a pack from future use; its versions, draft and rooms are kept. */
  archive(id: string, archived: boolean): boolean {
    const pack = this.catalog().find(p => p.id === id)
    if (!pack || (archived && this.active()?.content.pack.id === id)) return false
    const index = this.readIndex()
    index.packs = { ...index.packs, [id]: { ...pack, archived } }
    writeJsonAtomic(this.indexPath, index)
    return true
  }

  /**
   * Publish an immutable version and make it the pack's latest. The default
   * for new rooms is unchanged. The draft is cleared only when it is exactly
   * the content published. With `base`, publishing over a pack that changed
   * since the editor loaded it is a conflict.
   */
  publish(input: unknown, note: string, base?: string | null): PublishResult {
    const checked = validateContent(input)
    if (!checked.ok) return checked
    const { pack } = checked.content
    const existing = this.catalog().find(p => p.id === pack.id)
    if (base !== undefined) {
      if (base === null && existing) return { ok: false, conflict: true, revision: this.head(pack.id)?.revision ?? null }
      const conflict = base === null ? null : this.conflict(pack.id, base)
      if (conflict) return conflict
    }
    const index = this.readIndex()
    const id = `v${index.versions.length + 1}-${randomUUID().slice(0, 8)}`
    const hash = contentHash(checked.content)
    const version: VersionSummary = {
      id, createdAt: new Date().toISOString(), note: note.trim().slice(0, 120) || "Published from admin", hash,
      packId: pack.id, packName: pack.name, packVersion: pack.version, targetPoints: checked.content.rules.targetPoints,
    }
    writeJsonAtomic(join(this.versionsDir, `${id}.json`), checked.content)
    const draftPath = this.draftPath(pack.id)
    const clearDraft = !!existing?.draft && contentHash(JSON.parse(readFileSync(draftPath, "utf8"))) === hash
    index.versions.push(version)
    index.packs = { ...index.packs, [pack.id]: { id: pack.id, name: pack.name, archived: existing?.archived ?? false, published: id, draft: !!existing?.draft && !clearDraft } }
    writeJsonAtomic(this.indexPath, index)
    if (clearDraft) rmSync(draftPath, { force: true })
    return { ok: true, version, draftCleared: clearDraft }
  }

  /** Make a published version the default for new rooms. Moves no other pointer. */
  activate(id: string): ActivateResult {
    const version = this.version(id)
    if (!version) return { ok: false, code: "NOT_FOUND" }
    if (this.catalog().find(p => p.id === version.content.pack.id)?.archived) return { ok: false, code: "ARCHIVED" }
    const index = this.readIndex()
    index.active = id
    writeJsonAtomic(this.indexPath, index)
    return { ok: true }
  }
}
