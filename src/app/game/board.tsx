import { MenuIcon } from "lucide-react"
import { isApiError } from "../api"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { canCollect, hasLegalAction, type GameContext, type LogEntry, type PublicGameState } from "@/engine/client"
import { Button } from "@/components/ui/button"
import { Alert } from "@/components/ui/alert"
import { cn } from "@/lib/utils"
import type { RoomView } from "../api"
import { GameTitle, useDocumentTitle } from "../brand"
import type { Connection } from "../use-room"
import { asState, CardSheet, CollectSheet, type Act } from "./actions"
import { Achievements, PlayerCollection, Market, SectionTitle, SupplyRow } from "./board-parts"
import { StrengthStrip } from "./resource-strength"
import { EventDetail, EventHead, GameLog } from "./activity"
import { Scoreboard, seatsOf, type Seats } from "./scoreboard"
import { GameMenu } from "./game-menu"
import { noun, withArticle } from "./presentation"
import { IconKey } from "./icon-key"
import { describe, type EventLine } from "./pack-view"
import { ResponsiveSheet } from "@/components/responsive-sheet"

/** One toast per new event, in the same shape as Recent activity. */
function useTurnFeedback(ctx: GameContext, game: PublicGameState, meId: string, seats: Seats) {
  const seen = useRef(game.revision)
  useEffect(() => {
    const from = seen.current
    if (game.revision <= from) {
      seen.current = game.revision
      return
    }
    seen.current = game.revision
    const events = game.log
      .filter((e) => e.revision > from && e.type !== "start")
      .map((entry) => ({ entry, line: describe(ctx, game, entry) }))
      .filter((x): x is { entry: LogEntry; line: EventLine } => !!x.line)
    for (const { entry, line } of events) {
      toast(<EventHead entry={entry} line={line} seats={seats} />, {
        description: line.detail ? <EventDetail ctx={ctx} entry={entry} line={line} /> : undefined,
      })
    }
    if (game.status === "playing" && game.players[game.active].id === meId && events.length) toast("Your turn")
  }, [ctx, game, meId, seats])
}

export function Board({
  ctx,
  room,
  meId,
  connection,
  act,
  onLeave,
  onEnd,
  readOnly,
}: {
  ctx: GameContext
  room: RoomView
  meId: string
  connection: Connection
  act: Act
  onLeave: () => void
  onEnd: () => Promise<void>
  readOnly?: boolean
}) {
  const game = room.game!
  const [cardId, setCardId] = useState<string | null>(null)
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [collectOpen, setCollectOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const seats = useMemo(() => seatsOf(room), [room])
  useTurnFeedback(ctx, game, meId, seats)
  // The room's own pinned pack names the game, never the current default.
  useDocumentTitle(ctx.pack.labels.game)

  const me = game.players.find((p) => p.id === meId) ?? null
  const active = game.players[game.active]
  const myTurn = !readOnly && game.status === "playing" && active.id === meId
  const connected = Object.fromEntries(room.players.map((p) => [p.id, p.connected]))
  const viewed = playerId ? game.players.find((p) => p.id === playerId) : null
  const { labels } = ctx.pack
  const collectable = myTurn && canCollect(ctx, asState(game))
  const mustPass = myTurn && !!me && !hasLegalAction(ctx, asState(game), me)
  const pass = () => act({ type: "pass" }).catch((e) => toast.error(isApiError(e) ? e.message : "Could not pass"))
  const turnAction = (
    <>
      {mustPass ? (
        <Button className="min-h-11 w-full px-5 sm:min-h-10 sm:w-auto" onClick={pass}>
          Pass turn
        </Button>
      ) : (
        <Button className="h-auto min-h-11 w-full whitespace-normal px-5 sm:min-h-10 sm:w-auto" disabled={!collectable} onClick={() => setCollectOpen(true)}>
          {myTurn ? labels.collect : `Waiting for ${active.name}`}
        </Button>
      )}
      {mustPass && <p className="text-center text-sm text-muted-foreground">No legal action this turn.</p>}
      {myTurn && !mustPass && !collectable && <p className="text-center text-sm text-muted-foreground">The supply is empty. {labels.reserve} or {labels.acquire} {withArticle(noun(ctx.pack, "card"))}.</p>}
    </>
  )
  const finalRound = !!game.finalRound && game.status === "playing"
  const lastSeat = game.players[(game.firstPlayer + game.players.length - 1) % game.players.length].name

  const status =
    game.status === "finished" ? "Game over" : myTurn ? "Your turn" : `${active.name}'s turn${connected[active.id] === false ? " (disconnected)" : ""}`

  return (
    // viewport-fit=cover: in landscape the board keeps clear of the notch and rounded corners.
    // data-revision exposes the server revision on screen, so tests can wait for a device to catch up.
    <div data-revision={game.revision} className="flex min-h-dvh flex-col pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 w-full max-w-board items-center gap-3 px-4">
          <GameTitle title={ctx.pack.labels.game} icon={ctx.pack.icon} compact className="max-w-[45%] shrink-0" />
          <div className="flex min-w-0 flex-1 items-center justify-center gap-2 text-sm" aria-live="polite">
            <span className={cn("size-2 shrink-0 rounded-full", myTurn ? "bg-primary" : "bg-muted-foreground/40")} aria-hidden />
            <span className={cn("truncate", myTurn && "font-semibold")}>{status}</span>
          </div>
          <Button variant="ghost" size="icon" aria-label="Game menu" onClick={() => setMenuOpen(true)}>
            <MenuIcon />
          </Button>
        </div>
        {(connection === "polling" || finalRound) && (
          <div className="mx-auto flex w-full max-w-board flex-wrap gap-x-4 px-4 pb-2 text-xs text-muted-foreground">
            {finalRound && (
              <span>
                <span className="font-medium text-primary">Final round.</span> Ends after {lastSeat}'s turn.
              </span>
            )}
            {connection === "polling" && <span>Reconnecting. Updates may be a few seconds late.</span>}
          </div>
        )}
      </header>
      <Scoreboard ctx={ctx} game={game} meId={meId} seats={seats} onSelect={setPlayerId} />

      <main className="mx-auto w-full max-w-board flex-1 px-4 pt-4 pb-24 lg:pb-12">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,52rem)_21rem] lg:justify-between">
          <div className="flex min-w-0 flex-col gap-6">
            <Alert role="region" aria-labelledby="collect-callout" className="callout-brand flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex items-center gap-2">
                  <h2 id="collect-callout" className="text-base font-semibold">{labels.collect}</h2>
                  <IconKey ctx={ctx} />
                </div>
                <SupplyRow ctx={ctx} game={game} />
              </div>
              {!readOnly && game.status === "playing" && (
                <div className="flex flex-col gap-2 sm:max-w-[45%]">{turnAction}</div>
              )}
            </Alert>
            <Market ctx={ctx} game={game} me={readOnly ? null : me} onCard={setCardId} />
            <section aria-labelledby="achievements" className="flex flex-col gap-2">
              <SectionTitle id="achievements" aside={`${game.achievements.length - Object.keys(game.claimed).length} open`}>
                {labels.achievements}
              </SectionTitle>
              <Achievements ctx={ctx} game={game} />
            </section>
            {me && (
              <section aria-label={`Your ${labels.collection.toLowerCase()}`} data-collection="mobile" className="flex flex-col gap-3 lg:hidden">
                {/* No visible heading: its sections say what they are; the region keeps its name. */}
                <PlayerCollection ctx={ctx} game={game} player={me} onCard={setCardId} isMe />
              </section>
            )}
          </div>

          <aside className="hidden flex-col gap-8 lg:flex">
            {me && (
              <section aria-label={`Your ${labels.collection.toLowerCase()}`} data-collection="desktop" className="flex flex-col gap-4">
                <PlayerCollection ctx={ctx} game={game} player={me} onCard={setCardId} isMe />
              </section>
            )}
            <section aria-labelledby="log" className="flex flex-col gap-2">
              <SectionTitle id="log">Recent</SectionTitle>
              <GameLog ctx={ctx} game={game} seats={seats} limit={12} />
            </section>
          </aside>
        </div>
      </main>

      {me && !readOnly && game.status === "playing" && (
        <StrengthFooter label={`Open your ${labels.collection.toLowerCase()}`} onOpen={() => setPlayerId(me.id)}>
          <StrengthStrip ctx={ctx} player={me} />
        </StrengthFooter>
      )}

      <CardSheet ctx={ctx} game={game} me={readOnly ? null : me} cardId={cardId} onClose={() => setCardId(null)} act={act} />
      {me && !readOnly && <CollectSheet ctx={ctx} game={game} me={me} open={collectOpen} onOpenChange={setCollectOpen} act={act} />}
      <ResponsiveSheet
        open={!!viewed}
        onOpenChange={(o) => !o && setPlayerId(null)}
        title={viewed?.id === meId ? `Your ${labels.collection.toLowerCase()}` : `${viewed?.name}'s ${labels.collection.toLowerCase()}`}
        focusBody
      >
        {viewed && <PlayerCollection ctx={ctx} game={game} player={viewed} onCard={(id) => (setPlayerId(null), setCardId(id))} isMe={viewed.id === meId} />}
      </ResponsiveSheet>
      <GameMenu ctx={ctx} room={room} meId={meId} open={menuOpen} onOpenChange={setMenuOpen} onLeave={onLeave} onEnd={onEnd} />
    </div>
  )
}

/**
 * The phone's Resource strength bar, shaped like the top of a sheet. The whole
 * bar opens your collection, the same sheet as your box in the scores: tap it,
 * or flick it upward. The button is laid over the bar rather than wrapped
 * around it, so the strength list inside stays readable to assistive tech.
 * Touch listeners are passive and the bar sets no touch-action, so page
 * scrolling that starts on the bar works as before.
 */
function StrengthFooter({ label, onOpen, children }: { label: string; onOpen: () => void; children: React.ReactNode }) {
  const bar = useRef<HTMLDivElement>(null)
  // The latest callback, so a room update mid-flick does not reset the gesture.
  const open = useRef(onOpen)
  open.current = onOpen
  useEffect(() => {
    const el = bar.current!
    let start: { x: number; y: number } | null = null
    const down = (e: TouchEvent) => {
      const t = e.touches[0]
      start = e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null
    }
    const up = (e: TouchEvent) => {
      const t = e.changedTouches[0]
      if (start && start.y - t.clientY >= 24 && start.y - t.clientY > Math.abs(t.clientX - start.x)) open.current()
      start = null
    }
    el.addEventListener("touchstart", down, { passive: true })
    el.addEventListener("touchend", up, { passive: true })
    return () => {
      el.removeEventListener("touchstart", down)
      el.removeEventListener("touchend", up)
    }
  }, [])
  return (
    <div ref={bar} data-strength-footer className="fixed inset-x-0 bottom-0 z-30 rounded-t-lg border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 lg:hidden">
      <div className="mx-auto flex w-full max-w-board flex-col items-center gap-2 pt-2 pr-[calc(1rem+env(safe-area-inset-right))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[calc(1rem+env(safe-area-inset-left))]">
        <span className="h-1.5 w-12 shrink-0 rounded-full bg-muted" aria-hidden />
        <div className="w-full">{children}</div>
      </div>
      <button type="button" aria-label={label} onClick={onOpen} className="absolute inset-0 rounded-[inherit] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset" />
    </div>
  )
}
