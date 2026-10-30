import { permanentResources, canCollect, canAcquire, dueCost, heldTotal, points, type Action, type GameContext, type GameState, type PlayerState, type ResourceCounts } from "../engine/game"
import { evaluate, type PredicateSubject } from "../engine/predicates"
import { createRng, type Rng } from "../engine/rng"
import type { Card, Predicate } from "../engine/schema"
import { isLegal, legalActions, planDiscard, collectOptions, sum, visibleCardIds } from "./legal"

/*
 * Normal bot. Reads the same public state a player sees (market, supply, its own
 * resources and reserve, opponents' boards) and never the decks. Each turn it:
 *   1. acquires the most valuable affordable card, unless a much better target is one turn away;
 *   2. otherwise picks a target card by value per turn of effort;
 *   3. reserves that target when an opponent could acquire it first, or when collecting cannot help;
 *   4. otherwise collects the resources the target (then the runner-up) still needs.
 * Value = points + achievement completion and progress + how much the card's
 * permanent discount helps with other visible cards, shifting toward points late.
 * All randomness comes from the seed and only breaks ties, so decisions are reproducible.
 */

function scopedAcquired(ctx: GameContext, acquired: readonly string[], groups?: string[]) {
  return acquired
    .map((id) => ctx.index.cards.get(id))
    .filter((c): c is Card => !!c && (groups ? groups.includes(c.group) : ctx.index.groupKind.get(c.group) === "tiered"))
}

/** How close a subject is to a requirement, from 0 to 1. */
function progress(ctx: GameContext, pred: Predicate, s: PredicateSubject): number {
  switch (pred.type) {
    case "cardCount":
      return Math.min(1, scopedAcquired(ctx, s.acquired, pred.groups).filter((c) => !pred.permanentResource || c.permanentResource === pred.permanentResource).length / pred.min)
    case "distinctPermanentResources":
      return Math.min(1, new Set(scopedAcquired(ctx, s.acquired, pred.groups).map((c) => c.permanentResource)).size / pred.min)
    case "relationships": {
      const owned = new Set(scopedAcquired(ctx, s.acquired).map((c) => c.id))
      const fractions = ctx.pack.relationships
        .filter((r) => !pred.size || r.cardIds.length === pred.size)
        .map((r) => r.cardIds.filter((id) => owned.has(id)).length / r.cardIds.length)
        .sort((a, b) => b - a)
      return fractions.slice(0, pred.min).reduce((a, b) => a + b, 0) / pred.min
    }
    case "claimedCategory":
      return Math.min(1, s.achievements.filter((id) => ctx.index.achievementCategory.get(id) === pred.category).length / pred.min)
    case "all":
      return pred.of.reduce((a, p) => a + progress(ctx, p, s), 0) / pred.of.length
    case "any":
      return Math.max(...pred.of.map((p) => progress(ctx, p, s)))
  }
}

/** Points expected from open achievements if `me` acquires `card`: completions count fully, progress partly. */
function achievementGain(ctx: GameContext, state: GameState, me: PlayerState, card: Card): number {
  const before: PredicateSubject = { acquired: me.acquired, achievements: me.achievements }
  const after: PredicateSubject = { acquired: [...me.acquired, card.id], achievements: me.achievements }
  let gain = 0
  for (const id of state.achievements) {
    if (state.claimed[id]) continue
    const a = ctx.pack.achievements.find((x) => x.id === id)!
    if (evaluate(ctx.index, a.requirement, after)) gain += a.points
    else gain += 0.6 * a.points * Math.max(0, progress(ctx, a.requirement, after) - progress(ctx, a.requirement, before))
  }
  return gain
}

const isUnique = (ctx: GameContext, card: Card) => ctx.index.groupKind.get(card.group) === "unique"

interface Valued {
  card: Card
  value: number
  short: ResourceCounts
  missing: number
  turns: number
}

export function chooseNormalAction(ctx: GameContext, state: GameState, seed: string): Action {
  const rng = createRng(seed)
  const me = state.players[state.active]
  for (const action of rankActions(ctx, state, me, rng)) if (isLegal(ctx, state, action)) return action
  // Strategy found nothing legal: fall back to the first legal move (pass only when nothing else exists).
  return legalActions(ctx, state)[0]
}

function rankActions(ctx: GameContext, state: GameState, me: PlayerState, rng: Rng): Action[] {
  const { rules } = ctx
  const leader = Math.max(...state.players.map((p) => points(ctx, p)))
  const late = !!state.finalRound || leader >= rules.targetPoints - 4
  const myBonus = permanentResources(ctx, me)
  const uniqueFull = me.acquired.filter((id) => isUnique(ctx, ctx.index.cards.get(id)!)).length >= rules.uniqueLimitPerPlayer

  const ids = visibleCardIds(state, me)
  const cards = ids.map((id) => ctx.index.cards.get(id)!).filter((c) => !(isUnique(ctx, c) && uniqueFull))

  // How much a card's permanent discount helps with the other cards in view.
  const discountUse = (card: Card) => {
    let use = 0
    for (const other of cards) {
      if (other.id === card.id) continue
      const due = dueCost(ctx, me, other)
      if ((due[card.permanentResource] ?? 0) > 0) use += 0.25 + 0.12 * other.points
    }
    return Math.min(2.5, use)
  }

  const valueOf = (card: Card) => {
    const worth = card.points * (late ? 1.7 : 1)
    const discount = discountUse(card) * (late ? 0.25 : 1)
    // Early on, cheap discounts compound; late, only points matters.
    return worth + achievementGain(ctx, state, me, card) + discount + rng.next() * 0.01
  }

  const supply = state.supply.resources
  const valued: Valued[] = cards.map((card) => {
    const due = dueCost(ctx, me, card)
    const short: ResourceCounts = {}
    let scarce = 0
    for (const [k, n] of Object.entries(due)) {
      const miss = n - (me.resources[k] ?? 0)
      if (miss > 0) {
        short[k] = miss
        if ((supply[k] ?? 0) < miss) scarce += miss - (supply[k] ?? 0)
      }
    }
    const missing = Math.max(0, sum(short) - me.wildcards)
    const turns = Math.ceil(missing / rules.collect.distinct) + Math.ceil(scarce / 2)
    return { card, value: valueOf(card), short, missing, turns }
  })

  const actions: Action[] = []

  // 1. Acquire: the best affordable card by value net of resources spent.
  const affordable = valued.filter((v) => !canAcquire(ctx, state, me, v.card.id)).sort((a, b) => b.value - sum(dueCost(ctx, me, b.card)) * 0.1 - (a.value - sum(dueCost(ctx, me, a.card)) * 0.1))
  const plans = valued.filter((v) => v.missing > 0).sort((a, b) => b.value / (1 + b.turns) - a.value / (1 + a.turns))
  const target = plans[0]
  const runnerUp = plans[1]
  const bestAcquire = affordable[0]
  const waitForTarget = !!bestAcquire && !!target && target.turns <= 1 && target.value >= bestAcquire.value + 2.5 && bestAcquire.card.points === 0
  if (bestAcquire && !waitForTarget) actions.push({ type: "acquire", cardId: bestAcquire.card.id })

  // What the bot wants to keep when it must return resources.
  const keep: ResourceCounts = {}
  for (const v of [target, runnerUp]) if (v) for (const [k, n] of Object.entries(dueCost(ctx, me, v.card))) keep[k] = Math.max(keep[k] ?? 0, n)

  const wildOnReserve = Math.min(rules.wildcardsOnReserve, state.supply.wildcards)
  const reserve = (cardId: string): Action => ({ type: "reserve", cardId, discard: planDiscard(ctx, me, {}, wildOnReserve, keep) })
  const inMarket = (id: string) => ctx.pack.cardGroups.some((g) => g.kind === "tiered" && (state.market[g.id] ?? []).includes(id))
  const reserveRoom = me.reserved.length < rules.reserveCap

  // 2. Reserve to secure a valuable target an opponent could acquire first.
  if (target && reserveRoom && inMarket(target.card.id) && target.value >= 3) {
    const threatened = state.players.some((p) => p.id !== me.id && !canAcquire(ctx, state, p, target.card.id))
    if (threatened) actions.push(reserve(target.card.id))
  }

  // 3. Collect toward the target, then the runner-up.
  const want: ResourceCounts = {}
  if (target) for (const [k, n] of Object.entries(target.short)) want[k] = (want[k] ?? 0) + n * 2
  if (runnerUp) for (const [k, n] of Object.entries(runnerUp.short)) want[k] = (want[k] ?? 0) + n
  const options = collectOptions(ctx, state)
    .map((take) => {
      // Usefulness: resources that close a gap, capped by the gap; a little for flexibility otherwise.
      let use = 0
      for (const [k, n] of Object.entries(take)) {
        const gap = (target?.short[k] ?? 0) + (runnerUp?.short[k] ?? 0) * 0.5
        use += Math.min(n, Math.ceil(gap)) * (want[k] ? 1 : 0) + Math.max(0, n - Math.ceil(gap)) * 0.15
        use += 0.05 / (1 + (me.resources[k] ?? 0) + (myBonus[k] ?? 0))
      }
      const after = heldTotal(me) + sum(take)
      use -= Math.max(0, after - rules.holdingCap) * 0.35
      return { take, use: use + rng.next() * 0.001 }
    })
    .sort((a, b) => b.use - a.use)
  const bestCollect = options[0]
  const collectHelps = !!bestCollect && bestCollect.use > 0.5
  if (bestCollect && collectHelps) actions.push({ type: "collect", take: bestCollect.take, discard: planDiscard(ctx, me, bestCollect.take, 0, keep) })

  // 4. When collecting cannot help: reserve the target (or the best card in the market) for a wildcard.
  if (reserveRoom && (!canCollect(ctx, state) || !collectHelps)) {
    const pick = [target, ...plans.slice(1)].find((v) => v && inMarket(v.card.id))
    if (pick) actions.push(reserve(pick.card.id))
  }

  // 5. Anything else that is still sensible, best first.
  for (const o of options) actions.push({ type: "collect", take: o.take, discard: planDiscard(ctx, me, o.take, 0, keep) })
  for (const v of affordable) actions.push({ type: "acquire", cardId: v.card.id })
  return actions
}
