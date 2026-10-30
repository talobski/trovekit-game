import { permanentResources, type GameContext, type PlayerState, type ResourceKind } from "@/engine/client"

export interface KindStrength {
  kind: string
  /** Resources currently held (spendable). */
  held: number
  /** Permanent contribution from acquired cards (lowers costs; not spendable). */
  permanent: number
  total: number
}

/**
 * Effective resource strength toward collecting: per kind, held
 * Resources plus acquired cards' permanent contribution. Wildcards stay a
 * separate held count; they are never spread across kinds. Display only:
 * spendable inventory and the holding cap are unchanged.
 */
export function resourceStrength(ctx: GameContext, player: PlayerState): { kinds: KindStrength[]; wildcards: number } {
  const permanent = permanentResources(ctx, player)
  return {
    kinds: ctx.kinds.map((kind) => {
      const held = player.resources[kind] ?? 0
      const fixed = permanent[kind] ?? 0
      return { kind, held, permanent: fixed, total: held + fixed }
    }),
    wildcards: player.wildcards,
  }
}

/** One column of Resource strength: a kind, or the held wildcards. */
export interface StrengthColumn {
  id: string
  kind: ResourceKind | "wild"
  held: number
  permanent: number
  total: number
}

/**
 * Resource strength in display order: strongest first by total, wildcards
 * included, and ties kept in the pack's configured order (wildcards last), so
 * equal columns never swap places between updates. Desktop and mobile both use
 * this order.
 */
export function strengthColumns(ctx: GameContext, player: PlayerState): StrengthColumn[] {
  const strength = resourceStrength(ctx, player)
  const columns: StrengthColumn[] = [
    ...ctx.pack.resourceKinds.map((kind, i) => ({ id: kind.id, kind, held: strength.kinds[i].held, permanent: strength.kinds[i].permanent, total: strength.kinds[i].total })),
    { id: "wild", kind: "wild" as const, held: strength.wildcards, permanent: 0, total: strength.wildcards },
  ]
  return columns.map((c, order) => ({ c, order })).sort((a, b) => b.c.total - a.c.total || a.order - b.order).map(({ c }) => c)
}

