import type { GameState } from "./game"

/** What every client may see. Deck order and the seed stay on the server until the game ends. */
export type PublicGameState = Omit<GameState, "decks" | "seed"> & {
  deckCounts: Record<string, number>
  seed: string | null
}

export function projectGame(state: GameState): PublicGameState {
  const { decks, seed, ...rest } = state
  return {
    ...rest,
    deckCounts: Object.fromEntries(Object.entries(decks).map(([g, cards]) => [g, cards.length])),
    seed: state.status === "finished" ? seed : null,
  }
}
