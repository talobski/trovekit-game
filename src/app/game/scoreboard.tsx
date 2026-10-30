import { BotIcon, UserRoundIcon } from "lucide-react"
import { points, type GameContext, type PublicGameState } from "@/engine/client"
import { cn } from "@/lib/utils"
import type { RoomView } from "../api"

/** Seats as the room knows them: who is a bot, who is connected. */
export type Seats = Record<string, { bot: boolean; connected: boolean }>

export const seatsOf = (room: RoomView): Seats => Object.fromEntries(room.players.map((p) => [p.id, { bot: !!p.bot, connected: p.connected }]))

/** Human or bot. Decorative: names and labels carry the meaning. */
export function PlayerIcon({ bot, className }: { bot?: boolean; className?: string }) {
  const Icon = bot ? BotIcon : UserRoundIcon
  return <Icon className={cn("size-3.5 shrink-0 text-muted-foreground", className)} aria-hidden />
}

/**
 * Scores as a strip under the main header: one column per player, divided by
 * rules. The active seat is underlined and announced; the local player reads "You".
 */
export function Scoreboard({
  ctx,
  game,
  meId,
  seats,
  onSelect,
}: {
  ctx: GameContext
  game: PublicGameState
  meId: string
  seats: Seats
  onSelect: (playerId: string) => void
}) {
  const { labels } = ctx.pack
  return (
    <div className="border-b bg-background">
      <ol
        className="mx-auto grid w-full max-w-board divide-x px-4"
        style={{ gridTemplateColumns: `repeat(${game.players.length}, minmax(0, 1fr))` }}
        aria-label="Standings"
      >
        {game.players.map((p, i) => {
          const active = game.status === "playing" && game.active === i
          const me = p.id === meId
          const seat = seats[p.id]
          const pts = points(ctx, p)
          return (
            <li key={p.id} className="min-w-0">
              <button
                type="button"
                onClick={() => onSelect(p.id)}
                aria-current={active ? "step" : undefined}
                aria-label={`${p.name}${me ? " (you)" : ""}${seat?.bot ? ", bot" : ""}: ${pts} ${labels.points}, ${p.acquired.length} ${labels.acquired.toLowerCase()}${active ? ", taking their turn" : ""}${seat?.connected === false ? ", disconnected" : ""}`}
                className={cn(
                  "relative flex w-full min-w-0 flex-col gap-0.5 px-2 py-2 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-4",
                  // The active seat sits on a bar along the strip's bottom edge.
                  active && "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-primary"
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5 text-xs sm:text-sm">
                  <PlayerIcon bot={seat?.bot} className={cn(active && "text-foreground")} />
                  <span className={cn("truncate", me && "font-semibold")}>{me ? "You" : p.name}</span>
                  {seat?.connected === false && <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden />}
                </span>
                <span className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
                  <span className="num text-xl leading-tight font-semibold sm:text-2xl">{pts}</span>
                  <span className="truncate text-[0.6875rem] text-muted-foreground sm:text-xs">
                    {p.acquired.length} {labels.acquired.toLowerCase()}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
