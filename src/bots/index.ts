import { applyAction, type Action, type GameContext, type GameState } from "../engine/game"
import { chooseNormalAction } from "./normal"

/*
 * Bot players. A separate layer on top of the engine: bots read state and
 * propose actions; the engine (and, in rooms, the server) decides legality.
 */

export const BOT_LEVELS = ["normal"] as const
export type BotLevel = (typeof BOT_LEVELS)[number]

export type Chooser = (ctx: GameContext, state: GameState, seed: string) => Action

export const CHOOSERS: Record<BotLevel, Chooser> = { normal: chooseNormalAction }

export function chooseBotAction(level: BotLevel, ctx: GameContext, state: GameState, seed: string): Action {
  return CHOOSERS[level](ctx, state, seed)
}

/**
 * One seed per decision from the game seed, the revision and the seat. Player ids
 * are not used, so a fixed game seed and the same human moves replay a game exactly.
 */
export function botSeed(gameSeed: string, revision: number, seat: number): string {
  return `${gameSeed}:${revision}:${seat}`
}

/** Play a whole game with bots; `chooserFor` picks each seat's bot. Throws on an illegal bot move. */
export function playBotGame(
  ctx: GameContext,
  state: GameState,
  seed: string,
  chooserFor: (playerId: string) => Chooser = () => chooseNormalAction,
  maxTurns = 600
): GameState {
  let current = state
  while (current.status === "playing") {
    if (current.turn > maxTurns) throw new Error(`Game did not finish within ${maxTurns} turns`)
    const player = current.players[current.active]
    const action = chooserFor(player.id)(ctx, current, botSeed(seed, current.revision, current.active))
    const result = applyAction(ctx, current, player.id, action)
    if (!result.ok) throw new Error(`Bot proposed an illegal move: ${result.error.code} ${JSON.stringify(action)}`)
    current = result.state
  }
  return current
}

export { chooseNormalAction } from "./normal"
export { chooseGreedyAction, chooseRandomAction } from "./baseline"
export { legalActions } from "./legal"
