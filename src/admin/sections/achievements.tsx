import { PlusIcon, Trash2Icon } from "lucide-react"
import { useMemo, useState } from "react"
import type { Achievement, Pack } from "@/engine/schema"
import { packSemantics } from "@/engine/validate"
import { placeholderProblems, resolvePlaceholders } from "@/engine/text"
import { presentPack } from "@/app/game/presentation"
import { ResponsiveSheet } from "@/components/responsive-sheet"
import { Button } from "@/components/ui/button"
import { NumberField, Section, SelectField, TextField } from "../fields"
import { describePredicate, uniqueId } from "../model"
import { RequirementEditor } from "../requirement-editor"

/** Description with placeholders for names that follow renames, and a live reading in game words. */
function DescriptionField({ pack, value, onChange }: { pack: Pack; value: string; onChange: (v: string) => void }) {
  const problems = placeholderProblems(pack, value)
  return (
    <div className="col-span-2 flex flex-col gap-1.5">
      <TextField
        id="ach-description"
        label="Description"
        value={value}
        maxLength={160}
        onChange={onChange}
        hint="Use {group:id}, {kind:id} or {label:key} for names, so renames follow."
      />
      <p className="text-xs text-muted-foreground" aria-live="polite">
        Reads as: <span className="text-foreground">{resolvePlaceholders(presentPack(pack), value)}</span>
      </p>
      {problems.map((p) => (
        <p key={p} className="text-xs text-destructive">
          {p}
        </p>
      ))}
    </div>
  )
}

export function AchievementsSection({ pack, update }: { pack: Pack; update: (fn: (p: Pack) => Pack) => void }) {
  const [editing, setEditing] = useState<number | null>(null)
  const a = editing !== null ? pack.achievements[editing] : null
  // The pack's own checks, shown beside the requirement they concern; only while one is open.
  const issues = useMemo(() => {
    try {
      return a ? packSemantics(pack) : []
    } catch {
      return [] // an unfinished draft elsewhere; publishing still validates everything
    }
  }, [a, pack])
  const set = (patch: Partial<Achievement>) => update((p) => ({ ...p, achievements: p.achievements.map((x, i) => (i === editing ? { ...x, ...patch } : x)) }))
  const add = () => {
    const id = uniqueId("new-achievement", pack.achievements.map((x) => x.id))
    update((p) => ({
      ...p,
      achievements: [
        ...p.achievements,
        { id, category: p.achievementCategories[0].id, name: "New achievement", description: "Describe the goal", points: 2, requirement: { type: "cardCount", min: 4 } },
      ],
    }))
    setEditing(pack.achievements.length)
  }

  return (
    <div className="flex flex-col gap-10">
      <Section
        actions={
          <Button onClick={add}>
            <PlusIcon /> Add achievement
          </Button>
        }
      >
        <ul className="flex flex-col divide-y rounded-lg border">
          {pack.achievements.map((x, i) => (
            <li key={`${x.id}-${i}`}>
              <button
                type="button"
                onClick={() => setEditing(i)}
                className="grid w-full grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 px-3 py-2.5 text-left text-sm outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span className="font-medium">{x.name}</span>
                <span className="num font-semibold">+{x.points}</span>
                <span className="col-span-2 text-muted-foreground">
                  {pack.achievementCategories.find((c) => c.id === x.category)?.label ?? x.category} · {describePredicate(pack, x.requirement)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Categories">
        <div className="grid gap-4 sm:grid-cols-2">
          {pack.achievementCategories.map((c, i) => (
            <TextField
              key={c.id}
              id={`cat-${c.id}`}
              label={`Label (${c.id})`}
              value={c.label}
              maxLength={32}
              onChange={(label) => update((p) => ({ ...p, achievementCategories: p.achievementCategories.map((x, j) => (j === i ? { ...x, label } : x)) }))}
            />
          ))}
        </div>
      </Section>

      <ResponsiveSheet
        open={!!a}
        onOpenChange={(o) => !o && setEditing(null)}
        title={a?.name || "Achievement"}
        footer={
          <Button
            variant="ghost"
            className="text-destructive hover:bg-transparent hover:text-destructive hover:underline"
            onClick={() => {
              update((p) => ({ ...p, achievements: p.achievements.filter((_, i) => i !== editing) }))
              setEditing(null)
            }}
          >
            <Trash2Icon /> Delete achievement
          </Button>
        }
      >
        {a && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <TextField id="ach-name" label="Name" value={a.name} maxLength={40} onChange={(name) => set({ name })} className="col-span-2" />
              <TextField id="ach-id" label="Id" value={a.id} maxLength={48} onChange={(id) => set({ id })} />
              <NumberField id="ach-points" label="Points" value={a.points} onChange={(points) => set({ points })} />
              <SelectField
                id="ach-category"
                label="Category"
                value={a.category}
                options={pack.achievementCategories.map((c) => ({ value: c.id, label: c.label }))}
                onChange={(category) => set({ category })}
                className="col-span-2"
              />
              <DescriptionField pack={pack} value={a.description} onChange={(description) => set({ description })} />
            </div>
            <RequirementEditor key={editing} pack={pack} value={a.requirement} onChange={(requirement) => set({ requirement })} issues={issues} index={editing!} />
          </div>
        )}
      </ResponsiveSheet>
    </div>
  )
}
