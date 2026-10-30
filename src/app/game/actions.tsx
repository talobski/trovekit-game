import { MinusIcon, PlusIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import {
  permanentResources,
  canAcquire,
  checkCollect,
  dueCost,
  heldTotal,
  resolvePayment,
  type Action,
  type Card,
  type Discard,
  type GameContext,
  type GameState,
  type PlayerState,
  type PublicGameState,
  type ResourceCounts,
} from "@/engine/client"
import { ResponsiveSheet } from "@/components/responsive-sheet"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { isApiError } from "../api"
import { GameCard } from "./game-card"
import { actionError, noun } from "./presentation"
import { resourceList } from "./pack-view"
import { ResourceArtFill, ResourceDisc } from "./resource"
export type Act = (action: Action) => Promise<unknown>
/** Engine helpers only read public fields (market, supply, players); the projection is enough. */
export const asState = (game: PublicGameState) => game as unknown as GameState
const sum = (c: ResourceCounts) => Object.values(c).reduce((a, b) => a + b, 0)
async function run(ctx: GameContext, act: Act, action: Action, done: () => void, setBusy: (b: boolean) => void) {
  setBusy(true)
  try {
    await act(action)
    done()
  } catch (e) {
    toast.error(isApiError(e) ? actionError(ctx.pack, e) : "Something went wrong")
  } finally {
    setBusy(false)
  }
}
// ---------------------------------------------------------------------------
/** Pick exactly `excess` resources to return. Holdings are what the player would hold after the action. */
export function DiscardPicker({
  ctx,
  resources,
  wildcards,
  excess,
  value,
  onChange,
}: {
  ctx: GameContext
  resources: ResourceCounts
  wildcards: number
  excess: number
  value: Discard
  onChange: (d: Discard) => void
}) {
  const chosen = sum(value.resources ?? {}) + (value.wildcards ?? 0)
  const rows = [
    ...ctx.pack.resourceKinds.filter((k) => resources[k.id] > 0).map((k) => ({ id: k.id, kind: k as typeof k | "wild", label: k.label, held: resources[k.id], n: value.resources?.[k.id] ?? 0 })),
    ...(wildcards > 0 ? [{ id: "wild", kind: "wild" as const, label: ctx.pack.labels.wildcard, held: wildcards, n: value.wildcards ?? 0 }] : []),
  ]
  const set = (id: string, n: number) => {
    if (id === "wild") onChange({ ...value, wildcards: n })
    else onChange({ ...value, resources: { ...value.resources, [id]: n } })
  }
  const left = excess - chosen
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        You would hold more than {ctx.rules.holdingCap}. Choose {excess} to return.{" "}
        <span className={cn("font-medium", left === 0 ? "text-success" : "text-foreground")} aria-live="polite">
          {left === 0 ? "Ready." : `${left} left to choose.`}
        </span>
      </p>
      <ul className="divide-y rounded-lg border">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 px-3 py-2">
            <ResourceDisc kind={r.kind} size="sm" />
            <span className="flex-1 text-sm">
              {r.label}
              <span className="ml-1.5 text-muted-foreground">holding {r.held}</span>
            </span>
            <Button variant="outline" size="icon-sm" aria-label={`Return one fewer ${r.label}`} disabled={r.n === 0} onClick={() => set(r.id, r.n - 1)}>
              <MinusIcon />
            </Button>
            <span className="num w-5 text-center font-semibold" aria-label={`Returning ${r.n} ${r.label}`}>
              {r.n}
            </span>
            <Button variant="outline" size="icon-sm" aria-label={`Return one more ${r.label}`} disabled={r.n >= r.held || left <= 0} onClick={() => set(r.id, r.n + 1)}>
              <PlusIcon />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
// ---------------------------------------------------------------------------
export function CardSheet({
  ctx,
  game,
  me,
  cardId,
  onClose,
  act,
}: {
  ctx: GameContext
  game: PublicGameState
  me: PlayerState | null
  cardId: string | null
  onClose: () => void
  act: Act
}) {
  const [busy, setBusy] = useState(false)
  const [discard, setDiscard] = useState<Discard | null>(null)
  const card = cardId ? ctx.index.cards.get(cardId) : undefined
  const close = () => {
    setDiscard(null)
    onClose()
  }
  if (!card) return null
  const { labels, rules } = { labels: ctx.pack.labels, rules: ctx.rules }
  const group = ctx.pack.cardGroups.find((g) => g.id === card.group)!
  const kind = ctx.pack.resourceKinds.find((k) => k.id === card.permanentResource)!
  // The dialog keeps the neutral surface and takes its tier's border, from the same mapping as the market rows.
  const owner = game.players.find((p) => p.reserved.includes(card.id))
  const inMarket = Object.values(game.market).some((slots) => slots.includes(card.id))
  const myTurn = !!me && game.status === "playing" && game.players[game.active].id === me.id
  const mine = !!me && owner?.id === me.id
  const available = inMarket || mine
  const permanent = me ? permanentResources(ctx, me) : {}
  const due = me ? dueCost(ctx, me, card) : card.cost
  const acquireBlock = me && available ? canAcquire(ctx, asState(game), me, card.id) : null
  const payment = me && !acquireBlock ? resolvePayment(ctx, me, card) : null
  const shortBy = me ? Math.max(0, sum(due) - ctx.kinds.reduce((a, k) => a + Math.min(me.resources[k] ?? 0, due[k] ?? 0), 0) - me.wildcards) : 0
  const reservable = group.kind === "tiered" && inMarket
  const reserveWild = Math.min(rules.wildcardsOnReserve, game.supply.wildcards)
  const reserveExcess = me ? heldTotal(me) + reserveWild - rules.holdingCap : 0
  const reserveFull = !!me && me.reserved.length >= rules.reserveCap
  let acquireReason: string | null = null
  if (!me) acquireReason = null
  else if (!available) acquireReason = owner ? `In ${owner.name}'s ${labels.reserved.toLowerCase()} ${noun(ctx.pack, "cards")}` : null
  else if (!myTurn) acquireReason = "Wait for your turn"
  else if (acquireBlock?.code === "UNIQUE_LIMIT") acquireReason = `Your ${labels.collection.toLowerCase()} already has one`
  else if (acquireBlock?.code === "CANNOT_AFFORD") acquireReason = `You need ${shortBy} more`
  let reserveReason: string | null = null
  if (reservable && me) {
    if (!myTurn) reserveReason = "Wait for your turn"
    else if (reserveFull) reserveReason = `You already have ${rules.reserveCap} ${labels.reserved.toLowerCase()}`
  }
  const doAcquire = () => run(ctx, act, { type: "acquire", cardId: card.id }, close, setBusy)
  const doReserve = () => {
    if (reserveExcess > 0 && !discard) return setDiscard({ resources: {}, wildcards: 0 })
    run(ctx, act, { type: "reserve", cardId: card.id, discard: reserveExcess > 0 ? discard! : undefined }, close, setBusy)
  }
  const discardReady = discard && sum(discard.resources ?? {}) + (discard.wildcards ?? 0) === reserveExcess
  const footer = me && (available || reservable) && game.status === "playing" && (
    discard ? (
      <>
        <Button size="lg" disabled={!discardReady || busy} onClick={doReserve}>
          {labels.reserve} and return {reserveExcess}
        </Button>
        <Button variant="ghost" onClick={() => setDiscard(null)} disabled={busy}>
          Back
        </Button>
      </>
    ) : (
      <>
        {available && (
          <Button size="lg" disabled={!!acquireReason || busy} onClick={doAcquire}>
            {labels.acquire}
          </Button>
        )}
        {acquireReason && <p className="-mt-1 text-center text-sm text-muted-foreground">{acquireReason}</p>}
        {reservable && (
          <Button size="lg" variant="outline" disabled={!!reserveReason || busy} onClick={doReserve}>
            {labels.reserve}
            {reserveWild > 0 && <span className="text-muted-foreground">+{reserveWild} {labels.wildcard}</span>}
          </Button>
        )}
        {reserveReason && <p className="-mt-1 text-center text-sm text-muted-foreground">{reserveReason}</p>}
      </>
    )
  )
  return (
    <ResponsiveSheet
      open={!!cardId}
      onOpenChange={(o) => !o && close()}
      title={card.name}
      description={[group.label, kind.label, ...Object.values(card.meta ?? {})].join(" · ")}
      footer={footer || undefined}
      focusBody
    >
      {discard && me ? (
        <DiscardPicker
          ctx={ctx}
          resources={me.resources}
          wildcards={me.wildcards + reserveWild}
          excess={reserveExcess}
          value={discard}
          onChange={setDiscard}
        />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex justify-center pt-1">
            <GameCard ctx={ctx} card={card} size="lg" />
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{labels.points}</dt>
            <dd className="num font-semibold">{card.points}</dd>
            <dt className="text-muted-foreground">Permanent resource</dt>
            <dd>+1 {kind.label}, permanent. Lowers future {kind.label} costs by 1.</dd>
          </dl>
          {me && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold" style={{ fontFamily: "var(--font-body)" }}>
                Cost for you
              </h3>
              <ul className="divide-y rounded-lg border text-sm">
                {ctx.pack.resourceKinds
                  .filter((k) => card.cost[k.id])
                  .map((k) => {
                    const printed = card.cost[k.id]
                    const off = Math.min(printed, permanent[k.id] ?? 0)
                    return (
                      <li key={k.id} className="flex items-center gap-3 px-3 py-2">
                        <ResourceDisc kind={k} />
                        <span className="flex-1">{k.label}</span>
                        {off > 0 && (
                          <span className="text-muted-foreground">
                            <span className="line-through">{printed}</span> −{off}
                          </span>
                        )}
                        <span className="num w-6 text-right font-semibold">{due[k.id] ?? 0}</span>
                        <span className="w-20 text-right text-muted-foreground">have {me.resources[k.id] ?? 0}</span>
                      </li>
                    )
                  })}
              </ul>
              {payment?.ok && (
                <p className="text-sm">
                  {sum(due) === 0
                    ? "Free with your discounts."
                    : `Pays ${[resourceList(ctx, payment.payment.resources), payment.payment.wildcardTotal ? `${payment.payment.wildcardTotal} ${payment.payment.wildcardTotal > 1 ? labels.wildcards : labels.wildcard}` : ""].filter(Boolean).join(", ")}.`}
                </p>
              )}
            </div>
          )}
          <ImageCredit art={card.art} />
        </div>
      )}
    </ResponsiveSheet>
  )
}
// ---------------------------------------------------------------------------
export function CollectSheet({
  ctx,
  game,
  me,
  open,
  onOpenChange,
  act,
}: {
  ctx: GameContext
  game: PublicGameState
  me: PlayerState
  open: boolean
  onOpenChange: (open: boolean) => void
  act: Act
}) {
  const [take, setTake] = useState<ResourceCounts>({})
  const [discard, setDiscard] = useState<Discard | null>(null)
  const [busy, setBusy] = useState(false)
  const { collect, holdingCap } = ctx.rules
  const { labels } = ctx.pack
  const picked = Object.keys(take).filter((k) => take[k] > 0)
  const supply = game.supply.resources
  const reset = () => {
    setTake({})
    setDiscard(null)
  }
  const close = () => {
    reset()
    onOpenChange(false)
  }
  const tap = (kind: string) => {
    const n = take[kind] ?? 0
    const pairable = picked.length === 1 && picked[0] === kind && supply[kind] >= Math.max(collect.pairMinSupply, collect.pair)
    if (n === 0) {
      // Starting a new kind ends a pair selection.
      const next = picked.length === 1 && take[picked[0]] > 1 ? {} : { ...take }
      if (Object.keys(next).filter((k) => next[k] > 0).length >= collect.distinct) return
      setTake({ ...next, [kind]: 1 })
    } else if (n === 1 && pairable) setTake({ [kind]: collect.pair })
    else setTake({ ...take, [kind]: 0 })
    setDiscard(null)
  }
  const check = checkCollect(ctx, asState(game), take)
  const excess = heldTotal(me) + sum(take) - holdingCap
  const needsDiscard = check.ok && excess > 0
  const discardReady = !needsDiscard || (discard && sum(discard.resources ?? {}) + (discard.wildcards ?? 0) === excess)
  const submit = () => {
    if (needsDiscard && !discard) return setDiscard({ resources: {}, wildcards: 0 })
    run(ctx, act, { type: "collect", take, discard: needsDiscard ? discard! : undefined }, close, setBusy)
  }
  const after: ResourceCounts = Object.fromEntries(ctx.kinds.map((k) => [k, (me.resources[k] ?? 0) + (take[k] ?? 0)]))
  const hint = `Take ${collect.distinct} different, or ${collect.pair} of one kind when ${collect.pairMinSupply} or more remain.`
  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      // Wider dialog so five image-backed options keep phone-sized cards and readable labels.
      className="sm:max-w-2xl"
      title={labels.collect}
      description={hint}
      footer={
        discard ? (
          <>
            <Button size="lg" className="h-auto min-h-12 whitespace-normal" disabled={!discardReady || busy} onClick={submit}>
              {labels.collect} and return {excess}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setDiscard(null)}>
              Back
            </Button>
          </>
        ) : (
          <>
            <Button size="lg" className="h-auto min-h-12 whitespace-normal" disabled={!check.ok || busy} onClick={submit}>
              {check.ok && picked.length ? `${labels.collect} ${resourceList(ctx, take)}` : labels.collect}
            </Button>
            {picked.length > 0 && !check.ok && <p className="text-center text-sm text-muted-foreground">{check.error.message}</p>}
          </>
        )
      }
    >
      {discard ? (
        <DiscardPicker ctx={ctx} resources={after} wildcards={me.wildcards} excess={excess} value={discard} onChange={setDiscard} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <p className="text-sm">
              You hold <span className="num font-semibold">{heldTotal(me)}</span> of {holdingCap} {labels.resources}
              {sum(take) > 0 && (
                <>
                  , <span className="num font-semibold">{heldTotal(me) + sum(take)}</span> after this
                </>
              )}
              .
            </p>
          </div>
          <div className="grid auto-rows-fr grid-cols-3 gap-2 sm:grid-cols-5" role="group" aria-label="Supply">
            {ctx.pack.resourceKinds.map((k) => {
              const n = take[k.id] ?? 0
              const left = supply[k.id] ?? 0
              const art = ctx.pack.resourceArt
              return (
                <button
                  key={k.id}
                  type="button"
                  disabled={left === 0}
                  aria-pressed={n > 0}
                  aria-label={`${k.label}, ${left} in supply${n ? `, taking ${n}` : ""}`}
                  onClick={() => tap(k.id)}
                  // Every option fills its column whatever its label, and every row is as tall as the tallest, so a long label wraps without changing
                  // any option's size. The selection is drawn inside that box, so choosing changes nothing either.
                  className={cn(
                    "relative w-full min-w-0 self-stretch rounded-lg outline-none focus-visible:ring-[3px]",
                    art
                      ? // Image-backed option: the pack's resource picture, full bleed, with the kind's icon, name and count over it.
                        "resource-option flex aspect-[4/5] flex-col text-left focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      : cn("flex flex-col items-center gap-1.5 border px-1 py-3 transition-colors focus-visible:ring-ring/50", n > 0 ? "border-foreground bg-accent" : "hover:bg-accent/60"),
                    left === 0 && "opacity-40"
                  )}
                >
                  {art ? (
                    <span className="game-card-face resource-face relative isolate flex min-h-min flex-1 flex-col overflow-hidden rounded-[inherit]" style={{ "--option-tone": `var(--tone-${k.tone})` } as React.CSSProperties}>
                      <ResourceArtFill art={art} />
                      <span className="resource-top relative z-10 flex p-2">
                        <ResourceDisc kind={k} size="md" />
                      </span>
                      <span className="resource-bottom relative z-10 mt-auto flex flex-col gap-0.5 p-2 pt-6">
                        <span className="text-xs leading-tight font-semibold [overflow-wrap:anywhere]">{k.label}</span>
                        <span className="num text-xs opacity-85">{left} left</span>
                      </span>
                    </span>
                  ) : (
                    <>
                      <ResourceDisc kind={k} size="md" />
                      <span className="min-h-8 w-full text-center text-xs leading-tight [overflow-wrap:anywhere]">{k.label}</span>
                      <span className="num text-xs text-muted-foreground">{left} left</span>
                    </>
                  )}
                  {n > 0 && (
                    <span className="num absolute top-1.5 right-1.5 z-20 flex size-6 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
                      {n}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <p className="text-sm text-muted-foreground">Tap a kind again to take {collect.pair}.</p>
        </div>
      )}
    </ResponsiveSheet>
  )
}

/**
 * Where a card's image came from, as recorded with the artwork: at the very
 * bottom of the card details, small but readable, with ordinary links. Only
 * the fields that exist are shown; the attribution text is shown in full, since
 * a license may require it. Nothing here claims the rights were verified.
 */
function ImageCredit({ art }: { art: Card["art"] }) {
  if (!art || !(art.creator || art.source || art.license || art.licenseUrl || art.attribution)) return null
  const link = "underline underline-offset-2 hover:text-foreground"
  const parts = [
    art.creator && <span key="creator">{art.creator}</span>,
    art.source && <a key="source" className={link} href={art.source} target="_blank" rel="noreferrer noopener">Source</a>,
    art.licenseUrl ? <a key="license" className={link} href={art.licenseUrl} target="_blank" rel="noreferrer noopener">{art.license ?? "License"}</a> : art.license && <span key="license">{art.license}</span>,
  ].filter(Boolean)
  return (
    <section aria-label="Image credit" className="flex flex-col gap-1 border-t pt-3 text-xs text-muted-foreground">
      {parts.length > 0 && (
        <p className="break-words">
          Image:{" "}
          {parts.map((part, i) => (
            <span key={i}>
              {i > 0 && " · "}
              {part}
            </span>
          ))}
        </p>
      )}
      {art.attribution && <p className="break-words">{art.attribution}</p>}
    </section>
  )
}

