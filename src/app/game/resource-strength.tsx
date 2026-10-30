import { Bar, BarChart, Cell, XAxis, YAxis } from "recharts"
import type { GameContext, PlayerState } from "@/engine/client"
import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import { noun } from "./presentation"
import { strengthColumns, type StrengthColumn } from "./strength"
import { cn } from "@/lib/utils"
import { ResourceDisc } from "./resource"

/** Wildcards' bar: neutral, distinct from every kind's tone. */
const WILD = "color-mix(in oklab, var(--foreground) 70%, transparent)"
/** The permanent segment: the base colour deepened. The key below uses the same rule. */
export const deepen = (color: string) => `color-mix(in oklab, ${color}, black 35%)`
const deep = (tone: string) => deepen(`var(--tone-${tone})`)

/** What a column means, read by assistive tech in place of the bar and number. */
function columnLabel(ctx: GameContext, c: StrengthColumn): string {
  const { labels } = ctx.pack
  if (c.kind === "wild") return `${labels.wildcards}: ${c.total} held, usable as any kind when collecting`
  return `${c.kind.label}: ${c.total} (${c.held} held, ${c.permanent} from ${labels.acquired.toLowerCase()} ${noun(ctx.pack, "cards")})`
}

/**
 * Resource strength: per kind, a stacked bar of the
 * permanent contribution from acquired cards (deeper) under held resources
 * (the tone), with the total and icon beneath; then a neutral bar for held
 * wildcards. Strongest first: columns follow `strengthColumns`, and a
 * column whose total is zero is shown at half opacity. Every kind is shown,
 * zeros included.
 */
export function ResourceStrength({ ctx, player }: { ctx: GameContext; player: PlayerState; }) {
  const columns = strengthColumns(ctx, player)
  const data = columns.map((c) => ({
    id: c.id,
    held: c.held,
    permanent: c.permanent,
    heldFill: c.kind === "wild" ? WILD : `var(--tone-${c.kind.tone})`,
    permanentFill: c.kind === "wild" ? WILD : deep(c.kind.tone),
  }))
  const config = Object.fromEntries(data.map((d) => [d.id, { label: d.id }])) satisfies ChartConfig
  // A fixed minimum scale keeps small totals short instead of full height.
  const top = Math.max(6, ...data.map((d) => d.held + d.permanent))
  const grid = { gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }
  return (
    <div className="flex flex-col gap-2">
      {/* Decorative: the values below carry the same information for assistive tech. */}
      <div className="relative h-14" aria-hidden>
        {/* Tracks under every bar, zeros included (Recharts skips zero values).
            Columns match the chart's equal-width categories, so tracks sit under the bars. */}
        <div className="absolute inset-0 grid" style={grid}>
          {columns.map((c) => (
            <span key={c.id} className={cn("mx-auto h-full w-2.5 rounded-[3px] bg-muted-foreground/15", !c.total && "opacity-50")} />
          ))}
        </div>
        <ChartContainer config={config} className="absolute inset-0 aspect-auto">
          <BarChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }} barCategoryGap="35%" accessibilityLayer={false}>
            <XAxis dataKey="id" hide />
            <YAxis domain={[0, top]} hide />
            <Bar dataKey="permanent" stackId="strength" maxBarSize={10} radius={2} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.id} fill={d.permanentFill} />
              ))}
            </Bar>
            <Bar dataKey="held" stackId="strength" maxBarSize={10} radius={2} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.id} fill={d.heldFill} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      </div>
      <ul className="grid" style={grid} aria-label="Resource strength by kind">
        {columns.map((c) => (
          <li key={c.id} data-strength={c.id} className={cn("flex items-center justify-center gap-1", !c.total && "opacity-50")} aria-label={columnLabel(ctx, c)}>
            <ResourceDisc kind={c.kind} size="xs" />
            <span className="num text-sm font-semibold" aria-hidden>
              {c.total}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Resource strength for the phone's bottom bar: the same columns,
 * order and half-opacity zeros as the full view, as icon and total only. The
 * full view with its bars stays in the player's collection.
 */
export function StrengthStrip({ ctx, player, className }: { ctx: GameContext; player: PlayerState; className?: string }) {
  const columns = strengthColumns(ctx, player)
  // Equal columns, so six two-digit totals share the row at 320px instead of
  // overflowing it; narrow screens use smaller icons and tighter spacing.
  return (
    <ul className={cn("grid items-center", className)} style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }} aria-label="Resource strength">
      {columns.map((c) => (
        <li key={c.id} data-strength={c.id} className={cn("flex min-w-0 items-center justify-center gap-1 max-[379px]:gap-0.5", !c.total && "opacity-50")} aria-label={columnLabel(ctx, c)}>
          <ResourceDisc kind={c.kind} size="sm" className="max-[379px]:size-5" />
          <span className="num text-sm font-semibold tabular-nums" aria-hidden>
            {c.total}
          </span>
        </li>
      ))}
    </ul>
  )
}
