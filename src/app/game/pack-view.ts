import type { GameContext, LogEntry, PublicGameState, ResourceCounts } from "@/engine/client"
import { pastVerbs } from "./presentation"

export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\s'-]/gu, "").split(/\s+/).filter(Boolean)
  if (!parts.length) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function kindLabel(ctx: GameContext, id: string): string {
  return ctx.pack.resourceKinds.find((k) => k.id === id)?.label ?? id
}

export function resourceList(ctx: GameContext, counts: ResourceCounts): string {
  return ctx.kinds
    .filter((k) => counts[k])
    .map((k) => (counts[k] > 1 ? `${counts[k]} ${kindLabel(ctx, k)}` : kindLabel(ctx, k)))
    .join(", ")
}

export function cardName(ctx: GameContext, id: string): string {
  return ctx.index.cards.get(id)?.name ?? id
}

export interface EventLine {
  revision: number
  actor: string | null
  action: string
  detail: string
}

/** Describe log entries in pack vocabulary. */
export function describe(ctx: GameContext, game: PublicGameState, entry: LogEntry): EventLine | null {
  const { labels } = ctx.pack
  const verbs = pastVerbs(ctx.pack)
  const name = (id: string) => game.players.find((p) => p.id === id)?.name ?? "Someone"
  switch (entry.type) {
    case "start":
      return null
    case "collect":
      return { revision: entry.revision, actor: name(entry.player), action: verbs.collect, detail: resourceList(ctx, entry.resources) }
    case "reserve":
      return {
        revision: entry.revision,
        actor: name(entry.player),
        action: verbs.reserve,
        detail: cardName(ctx, entry.card) + (entry.wildcard ? `, +${entry.wildcard} ${labels.wildcard}` : ""),
      }
    case "acquire": {
      const card = ctx.index.cards.get(entry.card)
      return {
        revision: entry.revision,
        actor: name(entry.player),
        action: verbs.acquire,
        detail: cardName(ctx, entry.card) + (card?.points ? `, +${card.points} ${labels.points}` : ""),
      }
    }
    case "claim": {
      const a = ctx.pack.achievements.find((x) => x.id === entry.achievement)
      return { revision: entry.revision, actor: name(entry.player), action: "Claimed", detail: `${a?.name ?? entry.achievement}, +${a?.points ?? 0} ${labels.points}` }
    }
    case "discard": {
      const n = Object.values(entry.resources).reduce((a, b) => a + b, 0) + entry.wildcards
      return { revision: entry.revision, actor: name(entry.player), action: "Returned", detail: `${n} to the supply` }
    }
    case "pass":
      return { revision: entry.revision, actor: name(entry.player), action: "Passed", detail: "No legal action" }
    case "final-round":
      return { revision: entry.revision, actor: name(entry.player), action: `Reached ${ctx.rules.targetPoints} ${labels.points}`, detail: "The final round has started" }
    case "finish":
      return { revision: entry.revision, actor: null, action: "Game over", detail: entry.winners.map(name).join(" and ") }
  }
}
