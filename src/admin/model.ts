import { canonicalJson } from "@/engine/canonical"
import type { Pack, Predicate, Rules } from "@/engine/schema"

import type { Content } from "@/shared/content"

export type { Content }

export interface Change {
  area: "Pack" | "Rules" | "Resources" | "Groups" | "Cards" | "Achievements" | "Relationships" | "Categories"
  kind: "added" | "removed" | "changed"
  id: string
  detail: string
}

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)

function flat(value: unknown, prefix = ""): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.assign({}, ...Object.entries(value).map(([k, v]) => flat(v, prefix ? `${prefix}.${k}` : k)))
  }
  return { [prefix]: value }
}

function fieldChanges(a: unknown, b: unknown): string[] {
  const fa = flat(a)
  const fb = flat(b)
  const keys = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].sort()
  return keys
    .filter((k) => !same(fa[k], fb[k]))
    .map((k) => `${k}: ${fa[k] === undefined ? "none" : JSON.stringify(fa[k])} → ${fb[k] === undefined ? "none" : JSON.stringify(fb[k])}`)
}

function byId<T extends { id: string }>(area: Change["area"], from: T[], to: T[], name: (x: T) => string): Change[] {
  const out: Change[] = []
  const a = new Map(from.map((x) => [x.id, x]))
  const b = new Map(to.map((x) => [x.id, x]))
  for (const [id, x] of b) if (!a.has(id)) out.push({ area, kind: "added", id, detail: name(x) })
  for (const [id, x] of a) if (!b.has(id)) out.push({ area, kind: "removed", id, detail: name(x) })
  for (const [id, x] of b) {
    const prev = a.get(id)
    if (prev && !same(prev, x)) out.push({ area, kind: "changed", id, detail: fieldChanges(prev, x).join("; ") })
  }
  return out
}

/** Human-readable differences from `from` to `to`. */
export function diffContent(from: Content, to: Content): Change[] {
  const changes: Change[] = []
  const meta = (p: Pack) => ({ id: p.id, name: p.name, version: p.version, description: p.description, icon: p.icon, labels: p.labels, resourceArt: p.resourceArt })
  const packFields = fieldChanges(meta(from.pack), meta(to.pack))
  if (packFields.length) changes.push({ area: "Pack", kind: "changed", id: to.pack.id, detail: packFields.join("; ") })
  const ruleFields = fieldChanges(from.rules, to.rules)
  for (const f of ruleFields) changes.push({ area: "Rules", kind: "changed", id: f.split(":")[0], detail: f })
  changes.push(...byId("Resources", from.pack.resourceKinds, to.pack.resourceKinds, (k) => k.label))
  changes.push(...byId("Groups", from.pack.cardGroups, to.pack.cardGroups, (g) => g.label))
  changes.push(...byId("Cards", from.pack.cards, to.pack.cards, (c) => c.name))
  changes.push(...byId("Categories", from.pack.achievementCategories, to.pack.achievementCategories, (c) => c.label))
  changes.push(...byId("Achievements", from.pack.achievements, to.pack.achievements, (a) => a.name))
  changes.push(...byId("Relationships", from.pack.relationships, to.pack.relationships, (r) => r.label))
  return changes
}

/** Plain-language summary of a requirement, using pack labels. */
export function describePredicate(pack: Pack, p: Predicate): string {
  const kind = (id: string) => pack.resourceKinds.find((k) => k.id === id)?.label ?? id
  const groups = (ids?: string[]) => (ids ? ids.map((g) => pack.cardGroups.find((x) => x.id === g)?.label ?? g).join(" or ") : "tiered")
  switch (p.type) {
    case "cardCount":
      return `${p.min}+ ${groups(p.groups)} cards${p.permanentResource ? ` with ${kind(p.permanentResource)} as permanent resource` : ""}`
    case "distinctPermanentResources":
      return `${p.min}+ different permanent resources among ${groups(p.groups)} cards`
    case "relationships":
      return `${p.min}+ ${p.size ? `${p.size}-card ` : ""}relationships${p.disjoint ? ", no card shared" : ""}`
    case "claimedCategory":
      return `${p.min}+ claimed ${pack.achievementCategories.find((c) => c.id === p.category)?.label ?? p.category} achievements`
    case "all":
      return p.of.map((x) => describePredicate(pack, x)).join(" and ")
    case "any":
      return p.of.map((x) => describePredicate(pack, x)).join(" or ")
  }
}

export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/['’.]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "item"
  )
}

export function uniqueId(base: string, taken: Iterable<string>): string {
  const set = new Set(taken)
  let id = slug(base)
  for (let i = 2; set.has(id); i++) id = `${slug(base).slice(0, 44)}-${i}`
  return id
}

/** Keep each group's deckSize equal to its card count after edits. */
export function syncDeckSizes(pack: Pack): Pack {
  return {
    ...pack,
    cardGroups: pack.cardGroups.map((g) => ({ ...g, deckSize: pack.cards.filter((c) => c.group === g.id).length || g.deckSize })),
  }
}

export const IMPORT_LIMIT = 1024 * 1024

/** Parse an import file. Accepts {pack, rules}; a bare pack keeps the current rules. */
export function parseImport(text: string, currentRules: Rules): { ok: true; content: unknown } | { ok: false; message: string } {
  if (new Blob([text]).size > IMPORT_LIMIT) return { ok: false, message: "File is larger than 1 MB" }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    return { ok: false, message: `Not valid JSON: ${(e as Error).message}` }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, message: "Expected a JSON object" }
  const obj = data as Record<string, unknown>
  if ("pack" in obj || "rules" in obj) return { ok: true, content: obj }
  if ("schemaVersion" in obj && "cards" in obj) return { ok: true, content: { pack: obj, rules: currentRules } }
  return { ok: false, message: "Expected an object with pack and rules, or a pack" }
}
