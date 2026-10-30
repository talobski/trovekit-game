import type { Card, Pack, Predicate } from "./schema"

/** What a predicate can see about one player. Only acquired cards count; reserved cards and resources never do. */
export interface PredicateSubject {
  acquired: readonly string[]
  /** Achievement ids this player has claimed. */
  achievements: readonly string[]
}

export interface PackIndex {
  pack: Pack
  cards: Map<string, Card>
  groupKind: Map<string, "tiered" | "unique">
  achievementCategory: Map<string, string>
}

export function indexPack(pack: Pack): PackIndex {
  return {
    pack,
    cards: new Map(pack.cards.map((c) => [c.id, c])),
    groupKind: new Map(pack.cardGroups.map((g) => [g.id, g.kind])),
    achievementCategory: new Map(pack.achievements.map((a) => [a.id, a.category])),
  }
}

function acquiredCards(index: PackIndex, subject: PredicateSubject, groups?: string[]): Card[] {
  const out: Card[] = []
  for (const id of subject.acquired) {
    const card = index.cards.get(id)
    if (!card) continue
    const inScope = groups ? groups.includes(card.group) : index.groupKind.get(card.group) === "tiered"
    if (inScope) out.push(card)
  }
  return out
}

/** Largest number of pairwise-disjoint complete relationships (small inputs; exhaustive search). */
function maxDisjoint(sets: string[][]): number {
  let best = 0
  const walk = (start: number, used: Set<string>, count: number) => {
    best = Math.max(best, count)
    for (let i = start; i < sets.length; i++) {
      if (sets[i].some((id) => used.has(id))) continue
      sets[i].forEach((id) => used.add(id))
      walk(i + 1, used, count + 1)
      sets[i].forEach((id) => used.delete(id))
    }
  }
  walk(0, new Set(), 0)
  return best
}

export function completedRelationships(index: PackIndex, subject: PredicateSubject, size?: number): string[][] {
  const acquired = new Set(acquiredCards(index, subject).map((c) => c.id))
  return index.pack.relationships
    .filter((r) => (!size || r.cardIds.length === size) && r.cardIds.every((id) => acquired.has(id)))
    .map((r) => r.cardIds)
}

export function evaluate(index: PackIndex, pred: Predicate, subject: PredicateSubject): boolean {
  switch (pred.type) {
    case "cardCount":
      return acquiredCards(index, subject, pred.groups).filter((c) => !pred.permanentResource || c.permanentResource === pred.permanentResource).length >= pred.min
    case "distinctPermanentResources":
      return new Set(acquiredCards(index, subject, pred.groups).map((c) => c.permanentResource)).size >= pred.min
    case "relationships": {
      const done = completedRelationships(index, subject, pred.size)
      return (pred.disjoint ? maxDisjoint(done) : done.length) >= pred.min
    }
    case "claimedCategory":
      return subject.achievements.filter((id) => index.achievementCategory.get(id) === pred.category).length >= pred.min
    case "all":
      return pred.of.every((p) => evaluate(index, p, subject))
    case "any":
      return pred.of.some((p) => evaluate(index, p, subject))
  }
}
