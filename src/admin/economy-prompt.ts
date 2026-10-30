import type { CardGroup, Pack, Rules } from "@/engine/schema"

/*
 * Card-economy guidance for the AI prompts (full pack and card batches): how
 * the cards' permanent resources, costs and points are planned together. All
 * of it is advisory design guidance in Trovekit's own terms, never a rule the
 * engine or validation enforces; the creator's choices come first.
 */

/** Recommended pack sizes for five resource kinds: totals and tiers divisible by five. */
export const RECOMMENDED_SPLITS = [
  { total: 60, tiers: [25, 20, 15] },
  { total: 70, tiers: [30, 25, 15] },
  { total: 90, tiers: [40, 30, 20] },
] as const

/** Illustrative cost shapes (amounts per resource, whichever resources take them), cheapest tier first. */
const PATTERN_IDEAS: number[][][] = [
  [[3], [2, 2], [2, 2, 1], [1, 1, 1, 1]],
  [[3, 2, 2], [5, 3], [6]],
  [[5, 3, 3, 3], [6, 3, 3], [7, 3]],
]
/** A card's cost per resource is at most 15, over at most five resources (schema). */
const MAX_PER_RESOURCE = 15
const KINDS = 5

const total = (p: number[]) => p.reduce((a, b) => a + b, 0)
const shape = (p: number[]) => p.join("+")

/** `n` split as evenly as possible over up to `parts` resources, largest first (never a zero amount). */
function even(n: number, parts: number): number[] {
  return Array.from({ length: parts }, (_, i) => Math.floor(n / parts) + (i < n % parts ? 1 : 0)).filter((x) => x > 0)
}

/**
 * Two to four cost shapes that fit a group's actual cost range: the tier's own
 * ideas first, then other tiers' ideas, then even splits of its range. Ideas
 * outside the range (such as a tier-3 shape totalling more than its maximum)
 * are never offered.
 */
export function costPatterns(group: Pick<CardGroup, "cost">, tierIndex: number): number[][] {
  const { min, max } = group.cost
  const fits = (p: number[]) => total(p) >= Math.max(1, min) && total(p) <= max && p.length <= KINDS && p.every((x) => x >= 1 && x <= MAX_PER_RESOURCE)
  const out: number[][] = []
  const add = (p: number[]) => {
    if (out.length < 4 && fits(p) && !out.some((q) => shape(q) === shape(p))) out.push(p)
  }
  ;(PATTERN_IDEAS[tierIndex] ?? []).forEach(add)
  if (out.length < 2) PATTERN_IDEAS.flat().forEach(add)
  for (const n of [max, Math.round((min + max) / 2), Math.max(1, min)]) for (const parts of [3, 2, 4]) if (out.length < 3) add(even(n, parts))
  return out
}

const tiersOf = (groups: CardGroup[]) => groups.filter((g) => g.kind === "tiered")

/** The fewest tokens of one resource in the supply, and for how many players. */
function scarcest(rules: Rules) {
  const entries = Object.entries(rules.resourceSupply).map(([players, n]) => ({ players: Number(players), n }))
  return entries.reduce((a, b) => (b.n < a.n ? b : a))
}

/** The advisory economy guidelines, with this pack's real tiers, supply and points goal. */
export function economyGuidelines(rules: Rules, groups: CardGroup[]): string {
  const low = scarcest(rules)
  const counts = Object.entries(rules.resourceSupply).map(([players, n]) => `${n} with ${players} players`)
  const supply = `${counts.slice(0, -1).join(", ")} and ${counts.at(-1)}`
  const patterns = tiersOf(groups)
    .map((g, i) => `  - ${g.label} (cost ${g.cost.min} to ${g.cost.max}, points ${g.points.min} to ${g.points.max}): ${costPatterns(g, i).map(shape).join(", ")}`)
    .join("\n")
  const wild = rules.wildcardsOnReserve > 0
  return `Card economy (advisory design guidelines, not game rules; when my choices differ, follow my choices):
- Permanent resources: plan how many cards provide each resource; never assign them at random. With five resources, aim for the same number per resource within each tier when its card count is divisible by five, and across all tiers. Otherwise spread the remainder so no resource has more than one card more than another, rotating which resources get the extra card from tier to tier.
- Resource demand: balance what the costs ask for in two ways, the number of cards that require each resource and the total units of each resource required, within each tier and across the pack. Small differences are fine; avoid a resource being clearly more or less in demand than the others unless the design calls for it.
- Own resource: a card does not have to cost the resource it provides. Suggested share of cards whose cost includes their own permanent resource: about 10 to 20% in the first tier, about 40 to 60% in the higher tiers. This pushes players to build up different resources early. Adjust it when the design calls for it, and never make most cards depend chiefly on their own resource.
- Cost patterns: plan a few reusable number patterns per tier (the amounts of each resource in a cost, whichever resources take them), use them across the tier, and rotate which resources take each amount, so the same combinations do not repeat without a reason and the deck has a mix of cost shapes. Shapes that fit this pack's tiers (examples, not a fixed list):
${patterns}
- Difficulty and points: total cost is not difficulty. Each resource has ${supply} in the supply, players hold at most ${rules.holdingCap}, and they collect at most ${rules.collect.pair} of one kind per turn, so an amount of one resource above ${low.n} can only be paid with permanent discounts${wild ? " or wildcards" : ""} when ${low.players} play: a cost concentrated on one resource can be harder to pay than a larger total spread over several. Set points within each tier's range by weighing how many resources a cost uses, how concentrated it is, the permanent discounts players will likely have by then, ${wild ? `wildcards (${rules.wildcardSupply} in the supply, ${rules.wildcardsOnReserve} taken per reserve), ` : ""}the tier, the points goal of ${rules.targetPoints} and the achievements, never by total cost alone. Keep the differences between cards that I approved for the theme.`
}

/**
 * The private check before writing cards. In a conversation it is made against
 * the approved plan and asks before changing anything approved.
 */
export function economyCheck(approved = true): string {
  return `Before writing the cards, check the economy privately${approved ? " against the approved plan" : ""}: how many cards provide each resource, per tier and overall; how many cards require each resource and how many units of each are required, per tier and overall; the share of cards that cost their own resource in each tier; the mix of cost patterns; and every cost and points value within its tier's range. Correct any significant imbalance ${approved ? "the plan does not explain. If a correction would change something I approved, ask me first instead" : "the design does not explain"}. Do not show these checks unless I ask, and never claim the cards are balanced: only playing the game shows that.`
}

/** The discover-phase advice on how many cards, with the recommended splits. */
export function cardCountAdvice(): string {
  const splits = RECOMMENDED_SPLITS.map((s) => `${s.total} cards as ${s.tiers.slice(0, -1).join(", ")} and ${s.tiers.at(-1)} (${s.total / KINDS} cards providing each resource)`).join("; ")
  return `About how many cards, and how they split across the three tiers. A pack needs at least 60 cards. A total divisible by five lets each of the five resources be provided by the same number of cards, and tier counts divisible by five keep that true within each tier. Recommended: ${splits}. Any other count works too: the resources then differ by a card or so.`
}

/** The design-phase economy summary, shown before approval. */
export const ECONOMY_SUMMARY =
  "In part 3, include a short economy summary in a few plain lines: the total and each tier's number of cards; how many cards provide each resource, per tier and overall; whether demand for each resource is even, in cards requiring it and units required; the cost patterns planned for each tier; and how a game is expected to progress from cheap cards to the points goal. Mark which parts are my choices and which are your recommendations, leave out calculations unless I ask, and do not call the pack balanced: only playing it shows that."

/**
 * The existing pack's economy, computed from its cards, so an assistant plans
 * additions from facts rather than its own tally. Covers tiered groups; other
 * groups only show their count and room.
 */
export function packEconomy(pack: Pack): string {
  const label = (id: string) => pack.resourceKinds.find((k) => k.id === id)?.label ?? id
  const kinds = pack.resourceKinds.map((k) => k.id)
  const describe = (cards: Pack["cards"]) => {
    const provides = kinds.map((k) => `${label(k)} ${cards.filter((c) => c.permanentResource === k).length}`).join(", ")
    const demand = kinds
      .map((k) => {
        const using = cards.filter((c) => (c.cost[k] ?? 0) > 0)
        return `${label(k)} ${using.length} ${using.length === 1 ? "card" : "cards"} / ${using.reduce((n, c) => n + (c.cost[k] ?? 0), 0)} units`
      })
      .join(", ")
    const own = cards.filter((c) => (c.cost[c.permanentResource] ?? 0) > 0).length
    return { provides, demand, own: `${own} of ${cards.length}${cards.length ? ` (${Math.round((own / cards.length) * 100)}%)` : ""}` }
  }
  const lines = pack.cardGroups.map((g) => {
    const cards = pack.cards.filter((c) => c.group === g.id)
    const room = `${cards.length} ${cards.length === 1 ? "card" : "cards"}, room for ${200 - cards.length} more`
    if (g.kind !== "tiered") return `- ${g.label} (${room}).`
    if (!cards.length) return `- ${g.label} (${room}): no cards yet.`
    const d = describe(cards)
    const counts = new Map<string, number>()
    for (const c of cards) {
      const s = shape(Object.values(c.cost).filter((n) => n > 0).sort((a, b) => b - a))
      counts.set(s, (counts.get(s) ?? 0) + 1)
    }
    const patterns = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6).map(([s, n]) => `${s} (${n})`).join(", ")
    return `- ${g.label} (${room}):\n  - Provide: ${d.provides}.\n  - Required by: ${d.demand}.\n  - Cost their own resource: ${d.own}.\n  - Cost patterns: ${patterns}.`
  })
  const tiered = pack.cards.filter((c) => tiersOf(pack.cardGroups).some((g) => g.id === c.group))
  const all = describe(tiered)
  return `Current card economy, computed by Trovekit from the existing cards:
${lines.join("\n")}
- All tiered cards (${tiered.length}):\n  - Provide: ${all.provides}.\n  - Required by: ${all.demand}.\n  - Cost their own resource: ${all.own}.
- The pack holds ${pack.cards.length} of at most 400 cards; each group holds at most 200.`
}

/** How a batch relates to the existing economy: improve it where asked, never rewrite it. */
export const EXPANSION_ECONOMY =
  "Plan the new cards from this picture: recommend additions that keep or improve the balance, such as resources that fewer cards provide or require, cost patterns a tier rarely uses, and each tier's share of cards that cost their own resource. Adding cards to a group in multiples of five lets every resource gain equally, but a batch does not need to be perfectly even on its own, and what I ask for comes first. Do not change, rewrite or rebalance existing cards unless I explicitly ask to update one."
