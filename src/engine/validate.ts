import type { z } from "zod"
import { Pack, Rules, type Predicate } from "./schema"
import { placeholderProblems, resolvePlaceholders } from "./text"

export interface Issue {
  path: string
  message: string
}

export type Validated<T> = { ok: true; value: T; issues: [] } | { ok: false; issues: Issue[] }

export function zodIssues(error: z.ZodError): Issue[] {
  return error.issues.map((i) => ({ path: i.path.map(String).join(".") || "(root)", message: i.message }))
}

/** Parse and check a content pack: shape, then referential integrity and practical reachability. */
export function validatePack(input: unknown): Validated<Pack> {
  const parsed = Pack.safeParse(input)
  if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error) }
  const issues = packSemantics(parsed.data)
  return issues.length ? { ok: false, issues } : { ok: true, value: parsed.data, issues: [] }
}

/**
 * Referential integrity and practical reachability of a pack whose shape is
 * already valid. validatePack runs it only after the full shape check; the
 * admin's setup checklist also runs it on drafts that have no cards yet.
 */
export function packSemantics(pack: Pack): Issue[] {
  const issues: Issue[] = []
  const add = (path: string, message: string) => issues.push({ path, message })

  const unique = (items: { id: string }[], path: string) => {
    const seen = new Set<string>()
    items.forEach((item, i) => {
      if (seen.has(item.id)) add(`${path}.${i}.id`, `Duplicate id "${item.id}"`)
      seen.add(item.id)
    })
    return seen
  }

  const kinds = unique(pack.resourceKinds, "resourceKinds")
  const groups = unique(pack.cardGroups, "cardGroups")
  unique(pack.cards, "cards")
  const categories = unique(pack.achievementCategories, "achievementCategories")
  unique(pack.achievements, "achievements")
  unique(pack.relationships, "relationships")

  // Icons tell kinds apart without colour, so each kind needs its own.
  const icons = new Set<string>()
  pack.resourceKinds.forEach((k, i) => {
    if (icons.has(k.icon)) add(`resourceKinds.${i}.icon`, `Icon "${k.icon}" is already used by another resource kind`)
    icons.add(k.icon)
  })

  // Labels may name other labels ({label:resources}); what players see must stay short.
  for (const key of ["collect", "collected"] as const) {
    for (const problem of placeholderProblems(pack, pack.labels[key])) add(`labels.${key}`, problem)
    const shown = resolvePlaceholders(pack, pack.labels[key])
    if (shown.length > 32) add(`labels.${key}`, `Reads as "${shown}", which is longer than 32 characters`)
  }

  const uniqueGroups = pack.cardGroups.filter((g) => g.kind === "unique")
  if (uniqueGroups.length > 1) add("cardGroups", "At most one unique group is supported")
  if (!pack.cardGroups.some((g) => g.kind === "tiered")) add("cardGroups", "At least one tiered group is required")

  const groupById = new Map(pack.cardGroups.map((g) => [g.id, g]))
  const groupCounts = new Map<string, number>()
  const tieredNames = new Map<string, string>()
  pack.cards.forEach((card, i) => {
    const p = `cards.${i}`
    const group = groupById.get(card.group)
    if (!group) {
      add(`${p}.group`, `Unknown card group "${card.group}"`)
      return
    }
    groupCounts.set(group.id, (groupCounts.get(group.id) ?? 0) + 1)
    if (!kinds.has(card.permanentResource)) add(`${p}.permanentResource`, `Unknown resource kind "${card.permanentResource}"`)
    let total = 0
    for (const [kind, n] of Object.entries(card.cost)) {
      if (!kinds.has(kind)) add(`${p}.cost.${kind}`, `Unknown resource kind "${kind}"`)
      total += n
    }
    if (total < group.cost.min || total > group.cost.max)
      add(`${p}.cost`, `Total cost ${total} is outside ${group.label} range ${group.cost.min}-${group.cost.max}`)
    if (total === 0) add(`${p}.cost`, "Cost must be greater than zero")
    if (card.points < group.points.min || card.points > group.points.max)
      add(`${p}.points`, `Points ${card.points} is outside ${group.label} range ${group.points.min}-${group.points.max}`)
    if (group.kind === "tiered") {
      const key = card.name.toLowerCase()
      const other = tieredNames.get(key)
      if (other) add(`${p}.name`, `"${card.name}" already appears as card "${other}"`)
      tieredNames.set(key, card.id)
    }
  })
  pack.cardGroups.forEach((g, i) => {
    const n = groupCounts.get(g.id) ?? 0
    if (n !== g.deckSize) add(`cardGroups.${i}.deckSize`, `${g.label} has ${n} cards but deckSize is ${g.deckSize}`)
  })

  const cardById = new Map(pack.cards.map((c) => [c.id, c]))
  pack.relationships.forEach((rel, i) => {
    const seen = new Set<string>()
    rel.cardIds.forEach((id, j) => {
      const card = cardById.get(id)
      if (!card) add(`relationships.${i}.cardIds.${j}`, `Unknown card "${id}"`)
      else if (groupById.get(card.group)?.kind !== "tiered")
        add(`relationships.${i}.cardIds.${j}`, `"${id}" is not in a tiered group`)
      if (seen.has(id)) add(`relationships.${i}.cardIds.${j}`, `Card "${id}" is listed twice`)
      seen.add(id)
    })
  })

  const checkPredicate = (pred: Predicate, path: string, selfCategory: string) => {
    const checkGroups = (gs: string[] | undefined) =>
      gs?.forEach((g, j) => {
        if (!groups.has(g)) add(`${path}.groups.${j}`, `Unknown card group "${g}"`)
      })
    const pool = (gs: string[] | undefined) =>
      pack.cards.filter((c) => (gs ? gs.includes(c.group) : groupById.get(c.group)?.kind === "tiered"))
    switch (pred.type) {
      case "cardCount": {
        checkGroups(pred.groups)
        if (pred.permanentResource && !kinds.has(pred.permanentResource)) add(`${path}.permanentResource`, `Unknown resource kind "${pred.permanentResource}"`)
        const available = pool(pred.groups).filter((c) => !pred.permanentResource || c.permanentResource === pred.permanentResource).length
        if (available < pred.min) add(`${path}.min`, `Needs ${pred.min} matching cards but the pack has ${available}`)
        break
      }
      case "distinctPermanentResources": {
        checkGroups(pred.groups)
        const available = new Set(pool(pred.groups).map((c) => c.permanentResource)).size
        if (available < pred.min) add(`${path}.min`, `Needs ${pred.min} different permanent resources but the pack has ${available}`)
        break
      }
      case "relationships": {
        const available = pack.relationships.filter((r) => !pred.size || r.cardIds.length === pred.size).length
        if (available < pred.min) add(`${path}.min`, `Needs ${pred.min} relationships but the pack has ${available}`)
        break
      }
      case "claimedCategory": {
        if (!categories.has(pred.category)) add(`${path}.category`, `Unknown category "${pred.category}"`)
        const available = pack.achievements.filter((a) => a.category === pred.category).length - (pred.category === selfCategory ? 1 : 0)
        if (available < pred.min) add(`${path}.min`, `Needs ${pred.min} claims but only ${available} other achievements exist`)
        break
      }
      case "all":
      case "any":
        pred.of.forEach((p, j) => checkPredicate(p, `${path}.of.${j}`, selfCategory))
        break
    }
  }
  pack.achievements.forEach((a, i) => {
    if (!categories.has(a.category)) add(`achievements.${i}.category`, `Unknown category "${a.category}"`)
    checkPredicate(a.requirement, `achievements.${i}.requirement`, a.category)
    for (const problem of placeholderProblems(pack, a.description)) add(`achievements.${i}.description`, problem)
  })

  return issues
}

/** Parse rules and check them against the pack they will run with. */
export function validateRules(input: unknown, pack?: Pack): Validated<Rules> {
  const parsed = Rules.safeParse(input)
  if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error) }
  const rules = parsed.data
  const issues: Issue[] = []
  const add = (path: string, message: string) => issues.push({ path, message })

  if (rules.collect.pairMinSupply < rules.collect.pair)
    add("collect.pairMinSupply", "Must be at least the number of resources taken in a pair")
  if (pack) {
    for (let n = rules.playerCounts.min; n <= rules.playerCounts.max; n++) {
      const key = String(n) as "2" | "3" | "4"
      if (rules.achievementsDrawn[key] > pack.achievements.length)
        add(`achievementsDrawn.${key}`, `Draws ${rules.achievementsDrawn[key]} but the pack has ${pack.achievements.length} achievements`)
      if (rules.startingResources * n > rules.resourceSupply[key])
        add(`startingResources`, `Starting resources for ${n} players exceed the supply of ${rules.resourceSupply[key]}`)
    }
    if (rules.market.uniqueSlots > 0 && !pack.cardGroups.some((g) => g.kind === "unique"))
      add("market.uniqueSlots", "The pack has no unique group")
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: rules, issues: [] }
}
