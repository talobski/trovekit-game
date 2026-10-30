import type { Pack, Rules } from "@/engine/schema"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { NumberField, Section, SelectField } from "../fields"

export function RulesSection({ rules, pack, update }: { rules: Rules; pack: Pack; update: (fn: (r: Rules) => Rules) => void }) {
  const hasUniqueGroup = pack.cardGroups.some((group) => group.kind === "unique")
  const num = (id: string, label: string, get: (r: Rules) => number, set: (r: Rules, n: number) => Rules, hint?: string) => (
    <NumberField key={id} id={id} label={label} value={get(rules)} hint={hint} onChange={(n) => update((r) => set(structuredClone(r), n))} />
  )
  return (
    <div className="flex max-w-4xl flex-col gap-10">
      <Section title="Game" description="Changes reach new rooms once published and made the default. Existing rooms keep their version.">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {num("target", "Target points", (r) => r.targetPoints, (r, n) => ({ ...r, targetPoints: n }))}
          {num("players-min", "Min players", (r) => r.playerCounts.min, (r, n) => ({ ...r, playerCounts: { ...r.playerCounts, min: n } }))}
          {num("players-max", "Max players", (r) => r.playerCounts.max, (r, n) => ({ ...r, playerCounts: { ...r.playerCounts, max: n } }))}
          <SelectField
            id="tiebreak"
            label="Tie-break"
            value={rules.tieBreak}
            options={[
              { value: "fewest-acquired", label: "Fewest acquired cards, then shared" },
              { value: "shared", label: "Shared" },
            ]}
            onChange={(v) => update((r) => ({ ...r, tieBreak: v as Rules["tieBreak"] }))}
          />
        </div>
      </Section>

      <Section title="Supply">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(["2", "3", "4"] as const).map((k) => num(`supply-${k}`, `Resources per kind, ${k} players`, (r) => r.resourceSupply[k], (r, n) => ({ ...r, resourceSupply: { ...r.resourceSupply, [k]: n } })))}
          {num("wild-supply", "Wildcards", (r) => r.wildcardSupply, (r, n) => ({ ...r, wildcardSupply: n }))}
          {num("starting", "Starting resources per kind", (r) => r.startingResources, (r, n) => ({ ...r, startingResources: n }))}
        </div>
      </Section>

      <Section title="Turns">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {num("distinct", "Different kinds per collect", (r) => r.collect.distinct, (r, n) => ({ ...r, collect: { ...r.collect, distinct: n } }))}
          {num("pair", "Same-kind amount", (r) => r.collect.pair, (r, n) => ({ ...r, collect: { ...r.collect, pair: n } }))}
          {num("pair-min", "Supply needed for same-kind", (r) => r.collect.pairMinSupply, (r, n) => ({ ...r, collect: { ...r.collect, pairMinSupply: n } }))}
          {num("cap", "Holding cap", (r) => r.holdingCap, (r, n) => ({ ...r, holdingCap: n }))}
          {num("reserve", "Reserve cap", (r) => r.reserveCap, (r, n) => ({ ...r, reserveCap: n }))}
          {num("wild-reserve", "Wildcards per reserved card", (r) => r.wildcardsOnReserve, (r, n) => ({ ...r, wildcardsOnReserve: n }))}
          {hasUniqueGroup && num("unique-limit", "Unique cards per player", (r) => r.uniqueLimitPerPlayer, (r, n) => ({ ...r, uniqueLimitPerPlayer: n }))}
        </div>
        <div className="flex items-center gap-3">
          <Switch
            id="partial"
            checked={rules.collect.allowPartialDistinct}
            onCheckedChange={(v) => update((r) => ({ ...r, collect: { ...r.collect, allowPartialDistinct: v } }))}
          />
          <Label htmlFor="partial">Allow fewer different resources when fewer kinds remain</Label>
        </div>
      </Section>

      <Section title="Table">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {num("tiered-slots", "Face-up cards per tier", (r) => r.market.tieredSlots, (r, n) => ({ ...r, market: { ...r.market, tieredSlots: n } }))}
          {hasUniqueGroup && num("unique-slots", "Face-up unique cards", (r) => r.market.uniqueSlots, (r, n) => ({ ...r, market: { ...r.market, uniqueSlots: n } }))}
          {(["2", "3", "4"] as const).map((k) => num(`ach-${k}`, `Achievements, ${k} players`, (r) => r.achievementsDrawn[k], (r, n) => ({ ...r, achievementsDrawn: { ...r.achievementsDrawn, [k]: n } })))}
        </div>
      </Section>
    </div>
  )
}
