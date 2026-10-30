import type { Content } from "@/shared/content"
import { CardBatch, type BatchGuard } from "../card-batch"
import { artKey, CardImageEditor, CardImages } from "../images"
import { Trash2Icon } from "lucide-react"
import { useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import type { Card, Pack } from "@/engine/schema"
import { ResponsiveSheet } from "@/components/responsive-sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ResourceDisc } from "@/app/game/resource"
import { cn } from "@/lib/utils"
import { Textarea } from "@/components/ui/textarea"
import { FormField, NumberField, Section, SelectField, TextField } from "../fields"
import { uniqueId } from "../model"

export function CardsSection({ content, update, issuePaths, batch }: { content: Content; update: (fn: (p: Pack) => Pack) => void; issuePaths: Set<string>; batch: BatchGuard }) {
  const pack = content.pack
  const [group, setGroup] = useState("all")
  const [query, setQuery] = useState("")
  const [editing, setEditing] = useState<string | null>(null)

  const rows = useMemo(
    () =>
      pack.cards
        .map((c, index) => ({ c, index }))
        .filter(({ c }) => (group === "all" || c.group === group) && (!query || c.name.toLowerCase().includes(query.toLowerCase()) || c.id.includes(query.toLowerCase()))),
    [group, pack.cards, query]
  )
  const index = editing ? pack.cards.findIndex((c) => c.id === editing) : -1
  const card = index >= 0 ? pack.cards[index] : null

  const setCard = (patch: Partial<Card>) => {
    // By position and ID: an upload that finishes after the list changed must not update a different card.
    const id = card?.id
    update((p) => ({ ...p, cards: p.cards.map((c, i) => (i === index && c.id === id ? { ...c, ...patch } : c)) }))
    if (patch.id) setEditing(patch.id)
  }

  // The newest pack, for uploads that finish later.
  const latest = useRef(pack)
  latest.current = pack
  /** A finished upload for the card at `i`: applied only if that card's artwork is still what it was when the upload started. */
  const uploadArt = (id: string, i: number, name: string, before: string, art: NonNullable<Card["art"]>) => {
    const now = latest.current.cards[i]
    if (now?.id !== id || artKey(now.art) !== before) return void toast(`The image for ${name} finished uploading after its artwork changed, so it was not applied.`)
    update((p) => ({ ...p, cards: p.cards.map((c, j) => (j === i && c.id === id && artKey(c.art) === before ? { ...c, art } : c)) }))
  }

  const add = () => {
    const g = pack.cardGroups.find((x) => x.id === group) ?? pack.cardGroups[0]
    const permanentResource = pack.resourceKinds[0].id
    const other = pack.resourceKinds[1].id
    const id = uniqueId("new-card", pack.cards.map((c) => c.id))
    const fresh: Card = { id, group: g.id, name: "New card", cost: { [other]: Math.max(1, g.cost.min) }, permanentResource, points: g.points.min }
    update((p) => ({ ...p, cards: [...p.cards, fresh] }))
    setEditing(id)
  }

  const remove = () => {
    if (!card) return
    update((p) => ({ ...p, cards: p.cards.filter((c) => c.id !== card.id) }))
    setEditing(null)
  }

  const kind = (id: string) => pack.resourceKinds.find((k) => k.id === id)

  return (
    <div className="flex flex-col gap-10">
    <CardGroupsSection pack={pack} update={update} />
    <Section title="All cards">
      <CardBatch content={content} guard={batch} onAdd={add} images={pack.cards.length > 0 && <CardImages pack={pack} update={update} />} />
      {!pack.cards.length && <p className="text-sm text-muted-foreground">No cards yet. Generate them with your AI assistant, add them one at a time, or import a file.</p>}
      {pack.cards.length > 0 && <>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Select value={group} onValueChange={setGroup}>
          <SelectTrigger aria-label="Filter by group" className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All groups</SelectItem>
            {pack.cardGroups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input aria-label="Search cards" placeholder="Search by name or id" value={query} onChange={(e) => setQuery(e.target.value)} className="sm:max-w-xs" />
      </div>
      <ul aria-label="Cards" className="flex flex-col divide-y rounded-lg border">
        {rows.map(({ c, index: i }) => {
          const k = kind(c.permanentResource)
          const flagged = [...issuePaths].some((p) => p.startsWith(`pack.cards.${i}.`) || p === `pack.cards.${i}`)
          return (
            <li key={`${c.id}-${i}`}>
              <button
                type="button"
                onClick={() => setEditing(c.id)}
                className="grid w-full grid-cols-[1.5rem_1fr_auto] items-center gap-3 px-3 py-2.5 text-left text-sm outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:grid-cols-[1.5rem_1fr_8rem_10rem_3rem]"
              >
                {k && <ResourceDisc kind={k} />}
                <span className="min-w-0">
                  <span className={cn("block truncate font-medium", flagged && "text-destructive")}>{c.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{c.id}</span>
                </span>
                <span className="hidden text-muted-foreground sm:block">{pack.cardGroups.find((g) => g.id === c.group)?.label ?? c.group}</span>
                <span className="num hidden text-xs text-muted-foreground sm:block">
                  {Object.entries(c.cost).map(([id, n]) => {
                    const resource = kind(id)
                    return resource && <span key={id} className="mr-1 inline-flex items-center gap-0.5" role="img" aria-label={`${n} ${resource.label}`}><ResourceDisc kind={resource} size="xs" />{n}</span>
                  })}
                </span>
                <span className="num text-right font-semibold">{c.points}</span>
              </button>
            </li>
          )
        })}
        {!rows.length && <li className="px-3 py-6 text-center text-sm text-muted-foreground">{pack.cards.length ? "No cards match" : "No cards yet"}</li>}
      </ul>
      </>}

      <ResponsiveSheet
        open={!!card}
        onOpenChange={(o) => !o && setEditing(null)}
        title={card?.name || "Card"}
        footer={
          <Button variant="ghost" className="text-destructive hover:bg-transparent hover:text-destructive hover:underline" onClick={remove}>
            <Trash2Icon /> Delete card
          </Button>
        }
      >
        {card && (
          <div className="flex flex-col gap-4">
            <TextField id="card-name" label="Name" value={card.name} maxLength={48} onChange={(name) => setCard({ name })} />
            <div className="grid grid-cols-2 gap-4">
              <TextField id="card-short" label="Short name" value={card.shortName ?? ""} maxLength={18} onChange={(v) => setCard({ shortName: v || undefined })} />
              <TextField id="card-id" label="Id" value={card.id} maxLength={48} onChange={(id) => setCard({ id })} />
              <SelectField id="card-group" label="Group" value={card.group} options={pack.cardGroups.map((g) => ({ value: g.id, label: g.label }))} onChange={(g) => setCard({ group: g })} />
              <SelectField id="card-permanent-resource" label="Permanent resource" hint="Once acquired, lowers every later cost of this kind by 1" value={card.permanentResource} options={pack.resourceKinds.map((k) => ({ value: k.id, label: k.label }))} onChange={(permanentResource) => setCard({ permanentResource })} />
              <NumberField id="card-points" label="Points" value={card.points} onChange={(points) => setCard({ points })} />
            </div>
            <MetaField key={card.id} meta={card.meta} onChange={(meta) => setCard({ meta })} />
            <CardImageEditor card={card} onChange={art => setCard({ art })} onUpload={(art, before) => uploadArt(card.id, index, card.name, before, art)} />
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-2 text-sm font-medium">Cost</legend>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                {pack.resourceKinds.map((k) => (
                  <NumberField
                    key={k.id}
                    id={`cost-${k.id}`}
                    label={k.label}
                    value={card.cost[k.id] ?? 0}
                    min={0}
                    onChange={(n) => {
                      const cost = { ...card.cost }
                      if (n > 0 || Number.isNaN(n)) cost[k.id] = n
                      else delete cost[k.id]
                      setCard({ cost })
                    }}
                  />
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Total {Object.values(card.cost).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)}. Group range{" "}
                {(() => {
                  const g = pack.cardGroups.find((x) => x.id === card.group)
                  return g ? `${g.cost.min} to ${g.cost.max}` : "unknown"
                })()}
                .
              </p>
            </fieldset>
          </div>
        )}
      </ResponsiveSheet>
    </Section>
    </div>
  )
}

/** Groups (tiers) and their cost and points ranges. Deck size follows the cards in each group. */
function CardGroupsSection({ pack, update }: { pack: Pack; update: (fn: (p: Pack) => Pack) => void }) {
  return (
    <Section title="Card groups" description="Deck size follows the number of cards in each group.">
      <ul className="flex flex-col divide-y rounded-lg border">
        {pack.cardGroups.map((g, i) => {
          const set = (patch: Partial<typeof g>) => update((p) => ({ ...p, cardGroups: p.cardGroups.map((x, j) => (j === i ? { ...x, ...patch } : x)) }))
          return (
            <li key={g.id} className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-6 sm:items-end">
              <TextField id={`group-${g.id}-label`} label={`Label (${g.kind})`} value={g.label} maxLength={32} onChange={(label) => set({ label })} className="col-span-2" />
              <NumberField id={`group-${g.id}-cmin`} label="Cost min" value={g.cost.min} onChange={(min) => set({ cost: { ...g.cost, min } })} />
              <NumberField id={`group-${g.id}-cmax`} label="Cost max" value={g.cost.max} onChange={(max) => set({ cost: { ...g.cost, max } })} />
              <NumberField id={`group-${g.id}-pmin`} label="Points min" value={g.points.min} onChange={(min) => set({ points: { ...g.points, min } })} />
              <NumberField id={`group-${g.id}-pmax`} label="Points max" value={g.points.max} onChange={(max) => set({ points: { ...g.points, max } })} />
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

/**
 * A card's optional details (pack-defined, e.g. "house: Ashgrove"), one per line.
 * Shown under the card's name in the game. Applied when the field loses focus.
 */
function MetaField({ meta, onChange }: { meta: Card["meta"]; onChange: (meta: Card["meta"]) => void }) {
  const [text, setText] = useState(() => Object.entries(meta ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n"))
  const commit = () => {
    const entries = text
      .split("\n")
      .map((line) => line.match(/^\s*([^:]+):\s*(.+?)\s*$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => [uniqueId(m[1], []), m[2]] as const)
    onChange(entries.length ? Object.fromEntries(entries) : undefined)
  }
  return (
    <FormField id="card-meta" label="Details" hint="Optional, one per line, like “house: Ashgrove”. Shown with the card's group and resource.">
      <Textarea id="card-meta" value={text} rows={2} onChange={(e) => setText(e.target.value)} onBlur={commit} />
    </FormField>
  )
}
