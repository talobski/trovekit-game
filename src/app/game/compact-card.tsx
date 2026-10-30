import { CheckIcon } from "lucide-react"
import type { Card, GameContext } from "@/engine/client"
import { CardArt } from "@/components/card-art"
import { cn } from "@/lib/utils"
import { cardLabel } from "./game-card"
import { ResourceDisc } from "./resource"

/**
 * One size for every compact card: held resources, reserved
 * and acquired cards. 56 x 70: small enough to scan as a collection, wide enough for a
 * short name.
 */
export const COMPACT_CARD = "w-14 aspect-[4/5]"
/** How rows of compact cards wrap as a collection grows. */
export const COMPACT_LIST = "flex flex-wrap gap-1.5"

/**
 * The compact face: artwork behind a top row (left and right slots) and a bottom
 * block, over the shared photo face and shades. `tone` tints the bottom shade
 * (held resources use their kind's tone; players stay neutral).
 */
export function CompactFace({
  art,
  tone = "var(--photo-scrim)",
  topLeft,
  topRight,
  children,
}: {
  art: React.ReactNode
  tone?: string
  topLeft?: React.ReactNode
  topRight?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <span className="game-card-face resource-face relative isolate flex size-full flex-col overflow-hidden rounded-[inherit]" style={{ "--option-tone": tone } as React.CSSProperties}>
      {art}
      <span className="resource-top relative z-10 flex items-start justify-between gap-1 p-1">
        <span className="min-w-0">{topLeft}</span>
        {topRight}
      </span>
      <span className="resource-bottom relative z-10 mt-auto flex min-w-0 flex-col items-start gap-0.5 px-1 pt-3 pb-1">{children}</span>
    </span>
  )
}

/**
 * A card in a collection list, compact: points top left, its permanent resource icon top
 * right, name at the bottom (ellipsis when long). Costs stay in the detail view,
 * which opens on click, tap or Enter. Reserved cards that can be acquired now show the same
 * white check as market cards, just above the name.
 */
export function CompactCard({
  ctx,
  card,
  affordable,
  onClick,
}: {
  ctx: GameContext
  card: Card
  affordable?: boolean
  onClick: () => void
}) {
  const kind = ctx.pack.resourceKinds.find((k) => k.id === card.permanentResource)!
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={cardLabel(ctx, card, affordable)}
      className={cn(COMPACT_CARD, "relative block rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background")}
    >
      <CompactFace
        art={<CardArt card={card} fill className="text-sm" />}
        topLeft={<span className="num text-sm leading-none font-semibold">{card.points}</span>}
        topRight={<ResourceDisc kind={kind} size="xs" />}
      >
        {affordable && <CheckIcon className="size-3 shrink-0" strokeWidth={3} aria-hidden />}
        <span className="block w-full truncate text-[0.625rem] leading-tight font-semibold">{card.shortName ?? card.name}</span>
      </CompactFace>
    </button>
  )
}
