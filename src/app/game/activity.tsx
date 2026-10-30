import type { GameContext, LogEntry, PublicGameState, ResourceCounts } from "@/engine/client"
import { cardName, describe, type EventLine } from "./pack-view"
import { PlayerIcon, type Seats } from "./scoreboard"
import { ResourceCount } from "./resource"

/** Resource icons with quantities; each chip carries its full name for assistive tech. */
function Tokens({ ctx, counts, wildcards = 0 }: { ctx: GameContext; counts: ResourceCounts; wildcards?: number }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {ctx.pack.resourceKinds
        .filter((k) => counts[k.id])
        .map((k) => (
          <ResourceCount key={k.id} kind={k} label={k.label} count={counts[k.id]} size="xs" />
        ))}
      {wildcards > 0 && <ResourceCount kind="wild" label={ctx.pack.labels.wildcards} count={wildcards} size="xs" />}
    </span>
  )
}

/** The second line of an event: icons for resources, names for cards and achievements. */
function Detail({ ctx, entry, text }: { ctx: GameContext; entry: LogEntry; text: string }) {
  const { labels } = ctx.pack
  switch (entry.type) {
    case "collect":
      return <Tokens ctx={ctx} counts={entry.resources} />
    case "discard":
      return <Tokens ctx={ctx} counts={entry.resources} wildcards={entry.wildcards} />
    case "reserve":
      return (
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span>{cardName(ctx, entry.card)}</span>
          {entry.wildcard > 0 && <ResourceCount kind="wild" label={labels.wildcards} count={entry.wildcard} size="xs" />}
        </span>
      )
    case "acquire": {
      const card = ctx.index.cards.get(entry.card)
      return (
        <span>
          {cardName(ctx, entry.card)}
          {!!card?.points && <span className="text-muted-foreground">, +{card.points} {labels.points}</span>}
        </span>
      )
    }
    default:
      return <span className={entry.type === "pass" || entry.type === "final-round" ? "text-muted-foreground" : undefined}>{text}</span>
  }
}

/** First line of an event, shared by Recent activity and turn toasts: player icon, actor, past-tense action. */
export function EventHead({ entry, line, seats }: { entry: LogEntry; line: EventLine; seats: Seats }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {"player" in entry && <PlayerIcon bot={seats[entry.player]?.bot} />}
      {line.actor && <span className="truncate font-medium">{line.actor}</span>}
      <span className="shrink-0 text-muted-foreground">{line.action}</span>
    </span>
  )
}

/** Second line of an event, indented under the actor when there is one. */
export function EventDetail({ ctx, entry, line }: { ctx: GameContext; entry: LogEntry; line: EventLine }) {
  if (!line.detail) return null
  return (
    <span className={"player" in entry ? "block pl-5" : "block"}>
      <Detail ctx={ctx} entry={entry} text={line.detail} />
    </span>
  )
}

/** Recent events, newest first: actor and past-tense action, then a compact detail line. */
export function GameLog({ ctx, game, seats, limit }: { ctx: GameContext; game: PublicGameState; seats: Seats; limit?: number }) {
  const events = game.log
    .map((entry) => ({ entry, line: describe(ctx, game, entry) }))
    .filter((x): x is { entry: LogEntry; line: NonNullable<typeof x.line> } => !!x.line)
    .reverse()
    .slice(0, limit)
  return (
    <ol className="flex flex-col divide-y text-sm">
      {events.map(({ entry, line }, i) => (
        <li key={`${line.revision}-${i}`} className="flex flex-col gap-1 py-2.5 first:pt-0">
          <EventHead entry={entry} line={line} seats={seats} />
          <EventDetail ctx={ctx} entry={entry} line={line} />
        </li>
      ))}
    </ol>
  )
}
