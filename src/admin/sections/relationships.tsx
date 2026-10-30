import { PlusIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"
import type { Pack, Relationship } from "@/engine/schema"
import { ResponsiveSheet } from "@/components/responsive-sheet"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ComboboxField, FormField, Section, TextField } from "../fields"
import { uniqueId } from "../model"
import { cn } from "@/lib/utils"

export function RelationshipsSection({ pack, update }: { pack: Pack; update: (fn: (p: Pack) => Pack) => void }) {
  const [editing, setEditing] = useState<number | null>(null)
  const r = editing !== null ? pack.relationships[editing] : null
  const tiered = new Set(pack.cardGroups.filter((g) => g.kind === "tiered").map((g) => g.id))
  const options = pack.cards
    .filter((c) => tiered.has(c.group))
    .map((c) => ({ value: c.id, label: c.name }))
    .sort((a, b) => a.label.localeCompare(b.label))
  const name = (id: string) => pack.cards.find((c) => c.id === id)?.name ?? `Missing: ${id}`
  const spare = r ? options.find((o) => !r.cardIds.includes(o.value)) : undefined
  const set = (patch: Partial<Relationship>) => update((p) => ({ ...p, relationships: p.relationships.map((x, i) => (i === editing ? { ...x, ...patch } : x)) }))

  // A relationship needs two different tiered cards; a trio needs a third.
  const canAdd = options.length >= 2
  const add = () => {
    if (!canAdd) return
    const id = uniqueId("new-relationship", pack.relationships.map((x) => x.id))
    update((p) => ({ ...p, relationships: [...p.relationships, { id, label: "New relationship", cardIds: [options[0].value, options[1].value], note: "Teammates on ...", source: "Source" }] }))
    setEditing(pack.relationships.length)
  }

  return (
    <Section
      actions={
        <Button disabled={!canAdd} aria-describedby={canAdd ? undefined : "relationships-needs-cards"} onClick={add}>
          <PlusIcon /> Add relationship
        </Button>
      }
    >
      {!canAdd && (
        <p id="relationships-needs-cards" className="text-sm text-muted-foreground">
          {options.length ? "Add one more card to a tiered group to create a relationship." : "Add at least two cards to a tiered group to create a relationship."}
        </p>
      )}
      {pack.relationships.length === 0 && canAdd && <p className="text-sm text-muted-foreground">No relationships yet. They are optional unless an achievement needs them.</p>}
      <ul className={cn("flex flex-col divide-y rounded-lg border", !pack.relationships.length && "hidden")}>
        {pack.relationships.map((x, i) => (
          <li key={`${x.id}-${i}`}>
            <button
              type="button"
              onClick={() => setEditing(i)}
              className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-left text-sm outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span className="font-medium">
                {x.label} <span className="font-normal text-muted-foreground">· {x.cardIds.length === 2 ? "Duo" : "Trio"}</span>
              </span>
              <span className="text-muted-foreground">{x.cardIds.map(name).join(", ")}</span>
            </button>
          </li>
        ))}
      </ul>

      <ResponsiveSheet
        open={!!r}
        onOpenChange={(o) => !o && setEditing(null)}
        title={r?.label || "Relationship"}
        footer={
          <Button
            variant="ghost"
            className="text-destructive hover:bg-transparent hover:text-destructive hover:underline"
            onClick={() => {
              update((p) => ({ ...p, relationships: p.relationships.filter((_, i) => i !== editing) }))
              setEditing(null)
            }}
          >
            <Trash2Icon /> Delete relationship
          </Button>
        }
      >
        {r && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <TextField id="rel-label" label="Label" value={r.label} maxLength={60} onChange={(label) => set({ label })} />
              <TextField id="rel-id" label="Id" value={r.id} maxLength={48} onChange={(id) => set({ id })} />
            </div>
            {r.cardIds.map((id, j) => (
              <ComboboxField
                key={j}
                id={`rel-card-${j}`}
                label={`Card ${j + 1}`}
                value={id}
                options={options.some((o) => o.value === id) ? options : [{ value: id, label: name(id) }, ...options]}
                placeholder="Choose a card"
                searchPlaceholder="Search cards"
                emptyText="No card with that name"
                onChange={(v) => set({ cardIds: r.cardIds.map((x, k) => (k === j ? v : x)) })}
              />
            ))}
            <div className="flex gap-2">
              {r.cardIds.length === 2 ? (
                <Button variant="outline" size="sm" disabled={!spare} onClick={() => spare && set({ cardIds: [...r.cardIds, spare.value] })}>
                  Make it a trio
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => set({ cardIds: r.cardIds.slice(0, 2) })}>
                  Make it a duo
                </Button>
              )}
            </div>
            <FormField id="rel-note" label="Note" hint="Why these cards belong together">
              <Textarea id="rel-note" value={r.note} maxLength={300} onChange={(e) => set({ note: e.target.value })} />
            </FormField>
            <TextField id="rel-source" label="Source" value={r.source} maxLength={200} onChange={(source) => set({ source })} />
          </div>
        )}
      </ResponsiveSheet>
    </Section>
  )
}
