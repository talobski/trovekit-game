import { canAcquire, dueCost, type Action, type GameContext, type GameState } from "../engine/game"
import { createRng } from "../engine/rng"
import { legalActions, visibleCardIds } from "./legal"

/*
 * Baselines used only to measure the Normal bot in tests and simulations.
 * They are not offered to players.
 */

/** Picks uniformly among legal moves. */
export function chooseRandomAction(ctx: GameContext, state: GameState, seed: string): Action {
  const options = legalActions(ctx, state)
  return options[createRng(seed).int(options.length)]
}

/** Signs the highest-points affordable card; otherwise collects toward the highest-points card in view. */
export function chooseGreedyAction(ctx: GameContext, state: GameState): Action {
  const me = state.players[state.active]
  const legal = legalActions(ctx, state)
  const pointsOf = (a: Action) => (a.type === "acquire" ? ctx.index.cards.get(a.cardId)!.points : -1)
  const acquire = legal.filter((a) => a.type === "acquire").sort((a, b) => pointsOf(b) - pointsOf(a))[0]
  if (acquire) return acquire
  const target = visibleCardIds(state, me)
    .map((id) => ctx.index.cards.get(id)!)
    .filter((c) => canAcquire(ctx, state, me, c.id)?.code !== "UNIQUE_LIMIT")
    .sort((a, b) => b.points - a.points)[0]
  const due = target ? dueCost(ctx, me, target) : {}
  const gain = (a: Action) =>
    a.type === "collect" ? Object.entries(a.take).reduce((t, [k, n]) => t + Math.min(n, Math.max(0, (due[k] ?? 0) - (me.resources[k] ?? 0))), 0) : -1
  return legal.filter((a) => a.type === "collect").sort((a, b) => gain(b) - gain(a))[0] ?? legal[0]
}
