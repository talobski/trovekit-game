import { z } from "zod"
import { Card, Pack, Rules, type ResourceIcon } from "../engine/schema"
import { packSemantics, validatePack, validateRules, zodIssues, type Issue } from "../engine/validate"

/*
 * The single content contract shared by the game server, the private admin
 * server, the admin client and tests. Everything that accepts a pack and rules
 * (saving a version, importing JSON or a ZIP bundle, reviewing an import,
 * editing in the admin) validates through validateContent.
 */

export interface Content {
  pack: Pack
  rules: Rules
}

/** Shape of a complete pack and rules, used for the downloadable JSON schema. */
export const ContentSchema = z.strictObject({ pack: Pack, rules: Rules })

/** Drafts may have no cards yet, but still only accept the data-only schema. */
export const DraftSchema = z.strictObject({ pack: Pack.extend({ cards: z.array(Card).max(400) }), rules: Rules })

/** Library entry for one content pack (see server/content-store.ts). */
export interface PackSummary {
  id: string
  name: string
  /** Archived packs cannot become the default; their versions and rooms are kept. */
  archived: boolean
  /** Latest published version id. Making an older version the default never moves it. */
  published: string | null
  /** An unpublished draft is saved for this pack. */
  draft: boolean
}

/** One immutable published version. */
export interface VersionSummary {
  id: string
  createdAt: string
  note: string
  hash: string
  packId: string
  packName: string
  /** The pack's own version number, set by hand in the editor. */
  packVersion: string
  targetPoints: number
}

/**
 * What the editor opens for a pack: its saved draft, or else its latest
 * published version. `revision` identifies exactly this content; saving or
 * publishing over a different revision is refused as a conflict.
 */
export interface PackHead {
  content: Content
  revision: string
  source: "draft" | "published"
  versionId: string | null
}

export type ContentResult = { ok: true; content: Content } | { ok: false; issues: Issue[] }

const prefix = (path: string, issues: Issue[]) => issues.map((i) => ({ ...i, path: `${path}.${i.path}` }))

/** Shape, then pack semantics (references, ranges, deck sizes), then rules against that pack. */
export function validateContent(input: unknown): ContentResult {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { ok: false, issues: [{ path: "(root)", message: "Expected an object with pack and rules" }] }
  const { pack, rules, ...rest } = input as Record<string, unknown>
  const extra = Object.keys(rest)
  if (extra.length) return { ok: false, issues: [{ path: extra[0], message: `Unrecognized key "${extra[0]}"` }] }
  const p = validatePack(pack)
  if (!p.ok) return { ok: false, issues: prefix("pack", p.issues) }
  const r = validateRules(rules, p.value)
  if (!r.ok) return { ok: false, issues: prefix("rules", r.issues) }
  return { ok: true, content: { pack: p.value, rules: r.value } }
}

/**
 * Draft diagnostics for the admin's setup checklist; never a publishing check
 * (that is validateContent). validateContent stops at the first failing stage,
 * so a draft without cards is never checked for references or ranges. This
 * checks the pack against the draft schema (cards optional) and runs the
 * semantic and rules checks whenever that shape is valid. `checked` is false
 * when the semantic checks could not run at all.
 */
export function draftDiagnostics(content: Content): { checked: boolean; issues: Issue[] } {
  const shape = DraftSchema.shape.pack.safeParse(content.pack)
  const issues = prefix("pack", shape.success ? packSemantics(shape.data) : zodIssues(shape.error))
  const rules = validateRules(content.rules, shape.success ? shape.data : undefined)
  if (!rules.ok) issues.push(...prefix("rules", rules.issues))
  return { checked: shape.success, issues }
}

/**
 * How the public game names a pack: its Game title label (the pack's own name
 * may be a library name, such as "Starfall (old)") and its optional icon.
 */
export function packBrand(pack: Pack): { title: string; icon: ResourceIcon | null } {
  return { title: pack.labels.game, icon: pack.icon ?? null }
}

/** Every local image a pack references, with what uses it (a card id, or "resourceArt"). */
export function packImages(pack: Pack): { owner: string; src: string }[] {
  const images = pack.cards.flatMap((c) => (c.art ? [{ owner: c.id, src: c.art.src }] : []))
  if (pack.resourceArt) images.push({ owner: "resourceArt", src: pack.resourceArt.src })
  return images
}

/** Issues only; empty when the content is valid. */
export function contentIssues(input: unknown): Issue[] {
  const r = validateContent(input)
  return r.ok ? [] : r.issues
}
