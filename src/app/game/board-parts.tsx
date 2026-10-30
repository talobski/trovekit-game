import { useEffect, useRef, useState } from "react"
import { CheckIcon } from "lucide-react"
import { canAcquire, heldTotal, points, type GameContext, type PlayerState, type PublicGameState } from "@/engine/client"
import { cn } from "@/lib/utils"
import { asState } from "./actions"
import { EmptySlot, GameCard } from "./game-card"
import { ResourceCount } from "./resource"
import { TIER_CALLOUTS } from "./tiers"
import { HeldResources } from "./held-resources"
import { COMPACT_LIST, CompactCard } from "./compact-card"
import { deepen, ResourceStrength } from "./resource-strength"
import { noun } from "./presentation"
export function SectionTitle({ children, aside, id }: { children: React.ReactNode; aside?: React.ReactNode; id?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 id={id} className="text-base font-semibold">
        {children}
      </h2>
      {aside && <span className="text-sm text-muted-foreground">{aside}</span>}
    </div>
  )
}
export function SupplyRow({ ctx, game }: { ctx: GameContext; game: PublicGameState; }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" aria-label="Supply">
      {ctx.pack.resourceKinds.map((k) => (
        <ResourceCount key={k.id} kind={k} label={`${k.label} in supply`} count={game.supply.resources[k.id] ?? 0} />
      ))}
      <ResourceCount kind="wild" label={`${ctx.pack.labels.wildcards} in supply`} count={game.supply.wildcards} />
    </div>
  )
}
export function Market({
  ctx,
  game,
  me,
  onCard,
}: {
  ctx: GameContext
  game: PublicGameState
  me: PlayerState | null
  onCard: (id: string) => void
}) {
  const myTurn = !!me && game.status === "playing" && game.players[game.active].id === me.id
  return (
    <div className="flex flex-col gap-6">
      {ctx.pack.cardGroups.map((group, i) => (
        <section
          key={group.id}
          aria-labelledby={`row-${group.id}`}
          className={cn("callout-tier flex flex-col gap-2 rounded-lg border px-2 pt-3 pb-2 sm:p-4", TIER_CALLOUTS[i % TIER_CALLOUTS.length])}
        >
          <div className="px-1 sm:px-0">
            <SectionTitle id={`row-${group.id}`} aside={`${game.deckCounts[group.id] ?? 0} in deck`}>
              {group.label}
            </SectionTitle>
          </div>
          <MarketStrip>
            {(game.market[group.id] ?? []).map((id, slot) =>
              id ? (
                <GameCard
                  key={id}
                  ctx={ctx}
                  card={ctx.index.cards.get(id)!}
                  affordable={myTurn && !canAcquire(ctx, asState(game), me!, id)}
                  onClick={() => onCard(id)}
                />
              ) : (
                <EmptySlot key={`empty-${slot}`} label={`Empty ${group.label} slot`} />
              )
            )}
          </MarketStrip>
        </section>
      ))}
    </div>
  )
}

/**
 * One tier's cards in a single row. Cards share the row equally but never go
 * below the minimum width (cards.css); when they cannot fit, only this row
 * scrolls sideways, and the edge with more cards beyond it fades.
 */
function MarketStrip({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState({ start: false, end: false })
  useEffect(() => {
    const strip = ref.current!
    const update = () => {
      const start = strip.scrollLeft > 1
      const end = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1
      setMore((m) => (m.start === start && m.end === end ? m : { start, end }))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(strip)
    strip.addEventListener("scroll", update, { passive: true })
    return () => {
      observer.disconnect()
      strip.removeEventListener("scroll", update)
    }
  }, [])
  return (
    <div ref={ref} data-market-strip className="market-strip" data-more-start={more.start || undefined} data-more-end={more.end || undefined}>
      {children}
    </div>
  )
}
export function Achievements({ ctx, game }: { ctx: GameContext; game: PublicGameState }) {
  const name = (id: string) => game.players.find((p) => p.id === id)?.name
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {game.achievements.map((id) => {
        const a = ctx.pack.achievements.find((x) => x.id === id)!
        const by = game.claimed[id]
        return (
          <li key={id} className={cn("flex gap-3 rounded-lg border bg-card p-3", by && "bg-muted/60")}>
            <span className={cn("num flex size-10 shrink-0 items-center justify-center rounded-md text-lg font-semibold", by ? "bg-muted text-muted-foreground" : "bg-accent text-primary")}>
              +{a.points}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium leading-tight">{a.name}</span>
              <span className="text-sm text-muted-foreground">{a.description}</span>
              {/* Categories organise milestones in Admin; players see only who claimed one. */}
              {by && (
                <span className="inline-flex items-center gap-1 text-xs font-medium">
                  <CheckIcon className="size-3.5" /> Claimed by {name(by)}
                </span>
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
/** Tokens held and permanent discounts, per kind. */
export function PlayerCollection({
  ctx,
  game,
  player,
  onCard,
  isMe,
}: {
  ctx: GameContext
  game: PublicGameState
  player: PlayerState
  onCard: (id: string) => void
  isMe: boolean
}) {
  const { labels } = ctx.pack
  const acquiredByGroup = ctx.pack.cardGroups
    .map((g) => ({ group: g, cards: player.acquired.filter((id) => ctx.index.cards.get(id)?.group === g.id) }))
    .filter((x) => x.cards.length)
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2" aria-label="Resource strength">
        <SectionTitle>Resource strength</SectionTitle>
        <ResourceStrength ctx={ctx} player={player} />
        {/* Which part of each bar is which (pack words): lighter is spendable, deeper is permanent. */}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-1.5 rounded-sm bg-muted-foreground" aria-hidden />
            From held {labels.resources.toLowerCase()}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-1.5 rounded-sm" style={{ background: deepen("var(--muted-foreground)") }} aria-hidden />
            From {labels.acquired.toLowerCase()} {noun(ctx.pack, "cards")}
            <span className="sr-only">, which permanently lower future costs</span>
          </span>
        </p>
      </section>
      <div className="flex flex-col gap-2">
        <SectionTitle aside={`${heldTotal(player)} of ${ctx.rules.holdingCap} held`}>{isMe ? `Your ${labels.resources.toLowerCase()}` : labels.resources}</SectionTitle>
        <HeldResources ctx={ctx} player={player} />
      </div>
      <div className="flex flex-col gap-2">
        <SectionTitle aside={`${player.reserved.length} of ${ctx.rules.reserveCap}`}>{labels.reserved}</SectionTitle>
        {player.reserved.length ? (
          <ul className={COMPACT_LIST} aria-label={labels.reserved}>
            {player.reserved.map((id) => (
              <li key={id}>
                <CompactCard
                  ctx={ctx}
                  card={ctx.index.cards.get(id)!}
                  affordable={isMe && game.status === "playing" && game.players[game.active].id === player.id && !canAcquire(ctx, asState(game), player, id)}
                  onClick={() => onCard(id)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">None</p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <SectionTitle aside={`${points(ctx, player)} ${labels.points}`}>{labels.acquired}</SectionTitle>
        {acquiredByGroup.length ? (
          <ul className="flex flex-col gap-3">
            {acquiredByGroup.map(({ group, cards }) => (
              <li key={group.id} className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">{group.label}</span>
                {/* Same compact cards as Reserved and held resources; rows simply wrap as the collection grows. */}
                <ul className={COMPACT_LIST} aria-label={`${labels.acquired}, ${group.label}`}>
                  {cards.map((id) => (
                    <li key={id}>
                      <CompactCard ctx={ctx} card={ctx.index.cards.get(id)!} onClick={() => onCard(id)} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">None yet</p>
        )}
      </div>
      {player.achievements.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionTitle>{labels.achievements}</SectionTitle>
          <ul className="flex flex-col gap-1 text-sm">
            {player.achievements.map((id) => {
              const a = ctx.pack.achievements.find((x) => x.id === id)!
              return (
                <li key={id} className="flex justify-between gap-3">
                  <span>{a.name}</span>
                  <span className="num font-semibold">+{a.points}</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
