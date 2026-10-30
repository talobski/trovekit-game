import type { CSSProperties } from "react"
import { CheckIcon } from "lucide-react"
import type { Card, GameContext } from "@/engine/client"
import { cn } from "@/lib/utils"
import { CardArt } from "@/components/card-art"
import { ResourceDisc } from "./resource"
import { tierTone } from "./tiers"

export function CostRow({ ctx, cost, size = "xs", className }: { ctx: GameContext; cost: Record<string, number>; size?: "xs" | "sm"; className?: string }) {
  const kinds = ctx.pack.resourceKinds.filter((k) => cost[k.id])
  return (
    <span className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-1", className)}>
      {kinds.map((k) => (
        <span key={k.id} className="inline-flex items-center gap-px" role="img" aria-label={`${cost[k.id]} ${k.label}`}>
          <ResourceDisc kind={k} size={size} />
          <span className={cn("num font-semibold tabular-nums", size === "xs" ? "text-xs" : "text-sm")}>{cost[k.id]}</span>
        </span>
      ))}
    </span>
  )
}

export function costLabel(ctx: GameContext, cost: Record<string, number>) {
  return ctx.pack.resourceKinds
    .filter((k) => cost[k.id])
    .map((k) => `${cost[k.id]} ${k.label}`)
    .join(", ")
}

/** Full accessible description of a card, shared by full and compact faces. */
export function cardLabel(ctx: GameContext, card: Card, affordable?: boolean): string {
  const kind = ctx.pack.resourceKinds.find((k) => k.id === card.permanentResource)!
  const group = ctx.pack.cardGroups.find((g) => g.id === card.group)!
  return `${card.name}. ${group.label}. ${card.points} ${ctx.pack.labels.points}. Permanent resource ${kind.label}. Cost ${costLabel(ctx, card.cost)}.${affordable ? ` You can ${ctx.pack.labels.acquire.toLowerCase()} this now.` : ""}`
}

/** Full-bleed card face shared by the market, reserves, details and admin preview. */
export function GameCard({ ctx, card, affordable, onClick, size = "sm", className }: {
  ctx: GameContext
  card: Card
  affordable?: boolean
  onClick?: () => void
  size?: "sm" | "lg"
  className?: string
}) {
  const kind = ctx.pack.resourceKinds.find((k) => k.id === card.permanentResource)!
  const label = cardLabel(ctx, card, affordable)
  const Comp = onClick ? "button" : "div"
  const lg = size === "lg"
  // The row's tone, for a card without artwork (cards.css).
  const tone = tierTone(ctx, card.group)
  // The outer element is the stationary hit area; only the face moves on hover (see cards.css).
  return <Comp type={onClick ? "button" : undefined} onClick={onClick} aria-label={label} className={cn("game-card relative flex min-w-0 flex-col rounded-lg text-left", onClick && "outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background", lg && "game-card-large", className)} style={tone ? ({ "--card-tone": `var(--tone-${tone})` } as CSSProperties) : undefined}>
    <span className="game-card-face relative isolate flex flex-1 flex-col overflow-hidden rounded-[inherit]">
    <CardArt card={card} fill className={lg ? "text-4xl" : "text-xl"} />
    <span className="game-card-top relative z-10 flex items-start justify-between gap-1">
      <span className="flex items-center gap-1">
        <span className={cn("num font-semibold leading-none", lg ? "text-4xl" : "text-lg sm:text-2xl", !card.points && "invisible")}>{card.points}</span>
        {affordable && <CheckIcon className="size-4 shrink-0" strokeWidth={3} aria-hidden />}
      </span>
      <ResourceDisc kind={kind} size={lg ? "md" : "xs"} className={lg ? "" : "sm:size-6"}/>
    </span>
    <span className="game-card-bottom relative z-10 mt-auto flex min-w-0 flex-col gap-1.5">
      <span className={cn("font-semibold leading-tight", lg ? "text-base" : "truncate text-[0.6875rem] sm:text-sm")}>{lg ? card.name : card.shortName ?? card.name}</span>
      <CostRow ctx={ctx} cost={card.cost} size={lg ? "sm" : "xs"} className="gap-x-1"/>
    </span>
    </span>
  </Comp>
}

export function EmptySlot({ label }: { label: string }) {
  return (
    <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground sm:min-h-36">
      <span className="sr-only">{label}</span>
    </div>
  )
}
