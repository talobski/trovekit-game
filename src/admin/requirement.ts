import type { Issue } from "@/engine/validate"
import type { Pack, Predicate } from "@/engine/schema"

/**
 * The achievement requirement builder's model. It edits the existing
 * requirement JSON (PredicateSchema) directly and adds no new rule types: a
 * single condition, or "all" / "any" of single conditions. Anything nested
 * deeper stays as written and is edited as JSON.
 */

export type Condition = Exclude<Predicate, { type: "all" } | { type: "any" }>
export type ConditionType = Condition["type"]

export const CONDITION_TYPES: { value: ConditionType; label: string }[] = [
  { value: "cardCount", label: "Acquire cards" },
  { value: "distinctPermanentResources", label: "Different permanent resources" },
  { value: "relationships", label: "Complete relationships" },
  { value: "claimedCategory", label: "Claim achievements" },
]

/** Allowed required counts, as PredicateSchema sets them. */
export const COUNT_RANGE: Record<ConditionType, { min: number; max: number }> = {
  cardCount: { min: 1, max: 100 },
  distinctPermanentResources: { min: 1, max: 5 },
  relationships: { min: 1, max: 10 },
  claimedCategory: { min: 1, max: 20 },
}

/** "all" and "any" hold one to six conditions. */
export const MAX_CONDITIONS = 6

export const isCondition = (p: Predicate): p is Condition => p.type !== "all" && p.type !== "any"

/** Whether the form can show this requirement exactly; otherwise it is edited as JSON. */
export function fitsForm(p: Predicate): boolean {
  return isCondition(p) || p.of.every(isCondition)
}

/** A condition of another type, keeping the required count where it fits the new type's range. */
export function changeType(pack: Pack, from: Condition, type: ConditionType): Condition {
  if (from.type === type) return from
  const { min: lo, max: hi } = COUNT_RANGE[type]
  const min = Number.isFinite(from.min) ? Math.min(hi, Math.max(lo, from.min)) : lo
  if (type === "claimedCategory") return { type, category: pack.achievementCategories[0]?.id ?? "", min }
  return { type, min }
}

const plural = (n: number, one: string, many = `${one}s`) => `${Number.isFinite(n) ? n : "?"} ${n === 1 ? one : many}`
const RELATIONSHIP_SIZES: Record<number, string> = { 2: "duo", 3: "trio" }

/** One condition as a plain sentence, in the pack's own names. */
export function explainCondition(pack: Pack, c: Condition): string {
  const kind = (id: string) => pack.resourceKinds.find((k) => k.id === id)?.label ?? id
  const groups = (ids?: string[]) => (ids?.length ? `from ${ids.map((g) => pack.cardGroups.find((x) => x.id === g)?.label ?? g).join(" or ")}` : "from any tiered group")
  switch (c.type) {
    case "cardCount":
      return `Acquire at least ${plural(c.min, "card")} ${groups(c.groups)}${c.permanentResource ? ` with ${kind(c.permanentResource)} as their permanent resource` : ""}.`
    case "distinctPermanentResources":
      return `Acquire cards ${groups(c.groups)} with at least ${plural(c.min, "different permanent resource")}.`
    case "relationships": {
      const size = c.size ? RELATIONSHIP_SIZES[c.size] ?? `${c.size}-card` : null
      return `Complete at least ${plural(c.min, size ? `${size} relationship` : "relationship")}${c.disjoint ? ", with no card shared between them" : ""}.`
    }
    case "claimedCategory":
      return `Have claimed at least ${plural(c.min, `${pack.achievementCategories.find((x) => x.id === c.category)?.label ?? c.category} achievement`)}.`
  }
}

/** The whole requirement in plain language: a sentence, or a lead-in and one sentence per condition. */
export function explainRequirement(pack: Pack, p: Predicate): { lead?: string; lines: string[] } {
  if (isCondition(p)) return { lines: [explainCondition(pack, p)] }
  const lead = p.type === "all" ? "Meet all of these:" : "Meet any one of these:"
  // Nested combinations read as a combined line each.
  return { lead, lines: p.of.map((x) => (isCondition(x) ? explainCondition(pack, x) : `${x.type === "all" ? "All" : "Any"} of: ${explainRequirement(pack, x).lines.join(" ")}`)) }
}

/** Where in the requirement an issue path points: "Condition 2" inside a combination, or nothing for the whole. */
function whereIs(rest: string): string {
  const of = /^of\.(\d+)/.exec(rest)
  return of ? `Condition ${Number(of[1]) + 1}: ` : ""
}

/**
 * Problems with this requirement in plain language: counts outside their
 * range (from the form, before the schema sees them) and the pack's own
 * checks (packSemantics), such as asking for more relationships than exist.
 */
export function requirementProblems(pack: Pack, p: Predicate, issues: Issue[], achievementIndex: number): string[] {
  const out: string[] = []
  const conditions = isCondition(p) ? [{ c: p, at: "" }] : p.of.flatMap((c, i) => (isCondition(c) ? [{ c, at: `Condition ${i + 1}: ` }] : []))
  for (const { c, at } of conditions) {
    const { min: lo, max: hi } = COUNT_RANGE[c.type]
    if (!Number.isInteger(c.min) || c.min < lo || c.min > hi) out.push(`${at}Required count must be a whole number from ${lo} to ${hi}.`)
    if (c.type === "claimedCategory" && !pack.achievementCategories.some((x) => x.id === c.category)) out.push(`${at}Choose a category.`)
  }
  const prefix = `achievements.${achievementIndex}.requirement`
  for (const issue of issues) {
    if (issue.path !== prefix && !issue.path.startsWith(`${prefix}.`)) continue
    const message = `${whereIs(issue.path.slice(prefix.length + 1))}${issue.message}.`
    if (!out.includes(message)) out.push(message)
  }
  return out
}
