import type { GameContext } from "@/engine/client"

/** Supporting tone per market row, in tier order. Display only; packs carry no tier colour. */
export const TIER_CALLOUTS = ["callout-tier-1", "callout-tier-2", "callout-tier-3"] as const

/** Each market row's supporting tone, matching TIER_CALLOUTS. */
export const TIER_TONES = ["teal", "amber", "violet"] as const

/** The tone of a card group's market row. */
export function tierTone(ctx: GameContext, groupId: string): (typeof TIER_TONES)[number] | undefined {
  const i = ctx.pack.cardGroups.findIndex((g) => g.id === groupId)
  return i < 0 ? undefined : TIER_TONES[i % TIER_TONES.length]
}

/** The tier treatment for a card group, the same mapping the market rows use. */
export function tierCallout(ctx: GameContext, groupId: string): (typeof TIER_CALLOUTS)[number] | undefined {
  const i = ctx.pack.cardGroups.findIndex((g) => g.id === groupId)
  return i < 0 ? undefined : TIER_CALLOUTS[i % TIER_CALLOUTS.length]
}
