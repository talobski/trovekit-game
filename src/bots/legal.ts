import { applyAction, canAcquire, heldTotal, type Action, type Discard, type GameContext, type GameState, type PlayerState, type ResourceCounts } from "../engine/game"

/*
 * Legal-move helpers shared by every bot. Bots only ever choose from moves the
 * engine accepts; the engine stays the single authority on the rules.
 */

export const sum = (c: ResourceCounts | undefined) => Object.values(c ?? {}).reduce((a, b) => a + b, 0)

export function isLegal(ctx: GameContext, state: GameState, action: Action): boolean {
  // Legality never depends on deck contents, so a public projection (no decks) works too.
  const full = state.decks ? state : { ...state, decks: Object.fromEntries(Object.keys(state.market).map((g) => [g, []])) }
  return applyAction(ctx, full, state.players[state.active].id, action).ok
}

/** Cards a player could acquire or target: everything face-up plus their own reserve. */
export function visibleCardIds(state: GameState, player: PlayerState): string[] {
  return [...Object.values(state.market).flat(), ...player.reserved].filter((id): id is string => !!id)
}

/**
 * Return exactly the excess over the holding cap, keeping what `keep` values most.
 * `keep[kind]` is how much the bot wants to hold of that kind; wildcards go last.
 */
export function planDiscard(ctx: GameContext, player: PlayerState, gained: ResourceCounts, gainedWild: number, keep: ResourceCounts = {}): Discard | undefined {
  const resources: ResourceCounts = {}
  for (const k of ctx.kinds) resources[k] = (player.resources[k] ?? 0) + (gained[k] ?? 0)
  let wild = player.wildcards + gainedWild
  let excess = sum(resources) + wild - ctx.rules.holdingCap
  if (excess <= 0) return undefined
  const out: ResourceCounts = {}
  const take = (k: string) => {
    resources[k]--
    out[k] = (out[k] ?? 0) + 1
    excess--
  }
  // First anything held beyond what is wanted, largest surplus first; then the least wanted kinds.
  for (;;) {
    if (excess <= 0) break
    const surplus = ctx.kinds.filter((k) => resources[k] > (keep[k] ?? 0)).sort((a, b) => resources[b] - (keep[b] ?? 0) - (resources[a] - (keep[a] ?? 0)) || ctx.kinds.indexOf(a) - ctx.kinds.indexOf(b))
    if (!surplus.length) break
    take(surplus[0])
  }
  for (const k of ctx.kinds.slice().sort((a, b) => (keep[a] ?? 0) - (keep[b] ?? 0) || ctx.kinds.indexOf(a) - ctx.kinds.indexOf(b))) {
    while (excess > 0 && resources[k] > 0) take(k)
  }
  let wildcards = 0
  while (excess > 0 && wild > 0) {
    wild--
    wildcards++
    excess--
  }
  return { resources: out, wildcards }
}

function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]]
  if (items.length < size) return []
  const [first, ...rest] = items
  return [...combinations(rest, size - 1).map((c) => [first, ...c]), ...combinations(rest, size)]
}

/** Every legal collect selection (without discards). */
export function collectOptions(ctx: GameContext, state: GameState): ResourceCounts[] {
  const { collect } = ctx.rules
  const supply = state.supply.resources
  const available = ctx.kinds.filter((k) => (supply[k] ?? 0) > 0)
  const out: ResourceCounts[] = []
  if (available.length >= collect.distinct) {
    for (const combo of combinations(available, collect.distinct)) out.push(Object.fromEntries(combo.map((k) => [k, 1])))
  } else if (collect.allowPartialDistinct) {
    for (let size = available.length; size >= 1; size--) for (const combo of combinations(available, size)) out.push(Object.fromEntries(combo.map((k) => [k, 1])))
  }
  for (const k of ctx.kinds) if ((supply[k] ?? 0) >= Math.max(collect.pairMinSupply, collect.pair)) out.push({ [k]: collect.pair })
  return out
}

/** Every legal action for the active player, each with a default discard where one is required. */
export function legalActions(ctx: GameContext, state: GameState): Action[] {
  const me = state.players[state.active]
  const actions: Action[] = []
  for (const id of visibleCardIds(state, me)) if (!canAcquire(ctx, state, me, id)) actions.push({ type: "acquire", cardId: id })
  for (const take of collectOptions(ctx, state)) actions.push({ type: "collect", take, discard: planDiscard(ctx, me, take, 0) })
  if (me.reserved.length < ctx.rules.reserveCap) {
    const wild = Math.min(ctx.rules.wildcardsOnReserve, state.supply.wildcards)
    for (const g of ctx.pack.cardGroups) {
      if (g.kind !== "tiered") continue
      for (const id of state.market[g.id] ?? []) if (id) actions.push({ type: "reserve", cardId: id, discard: heldTotal(me) + wild > ctx.rules.holdingCap ? planDiscard(ctx, me, {}, wild) : undefined })
    }
  }
  const legal = actions.filter((a) => isLegal(ctx, state, a))
  return legal.length ? legal : [{ type: "pass" }]
}
