import type { GameContext, PlayerState, ResourceKind } from "@/engine/client"
import { COMPACT_CARD, COMPACT_LIST, CompactFace } from "./compact-card"
import { ResourceArtFill, ResourceDisc } from "./resource"

/**
 * Held resources as compact cards: only kinds actually held,
 * each with its icon (top right) and quantity over the pack's resource picture. Wildcards count toward the
 * holding cap, so they get a card when held. No picture: plain muted cards.
 */
export function HeldResources({ ctx, player }: { ctx: GameContext; player: PlayerState; }) {
  const held: { kind: ResourceKind | "wild"; label: string; count: number }[] = [
    ...ctx.pack.resourceKinds.map((k) => ({ kind: k, label: k.label, count: player.resources[k.id] ?? 0 })),
    { kind: "wild" as const, label: ctx.pack.labels.wildcards, count: player.wildcards },
  ].filter((x) => x.count > 0)
  if (!held.length) return <p className="text-sm text-muted-foreground">None held</p>
  const art = ctx.pack.resourceArt
  return (
    <ul className={COMPACT_LIST} aria-label={`Held ${ctx.pack.labels.resources.toLowerCase()}`}>
      {held.map(({ kind, label, count }) => {
        const icon = <ResourceDisc kind={kind} size="xs" />
        const number = <span className="num w-full text-center text-sm leading-tight font-semibold">{count}</span>
        return (
          <li key={kind === "wild" ? "wild" : kind.id} className={COMPACT_CARD} aria-label={`${label}: ${count}`}>
            {art ? (
              <span className="block size-full rounded-md" aria-hidden>
                <CompactFace art={<ResourceArtFill art={art} />} tone={kind === "wild" ? "var(--foreground)" : `var(--tone-${kind.tone})`} topRight={icon}>
                  {number}
                </CompactFace>
              </span>
            ) : (
              // No pack picture: a plain card with the same layout.
              <span className="flex size-full flex-col rounded-md border bg-muted/50 p-1" aria-hidden>
                <span className="flex justify-end">{icon}</span>
                <span className="mt-auto">{number}</span>
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
