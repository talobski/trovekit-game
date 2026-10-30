import { RESOURCE_ICONS, TONES, type Pack, type ResourceIcon, type Tone } from "@/engine/schema"
import { TONE_SOLID } from "@/lib/tones"
import { cn } from "@/lib/utils"
import { Section, SelectField, TextField } from "../fields"
import { RESOURCE_ICON_COMPONENTS, ResourceDisc } from "@/app/game/resource"
import { ResourceArtEditor } from "../images"

/** The Lucide icon choices for the Icon select: resource kinds, and the pack's title icon in Settings. */
export const ICON_OPTIONS = RESOURCE_ICONS.map((icon) => {
  const Icon = RESOURCE_ICON_COMPONENTS[icon]
  return { value: icon as string, label: icon.replace("-", " "), prefix: <Icon className="size-3.5" aria-hidden /> }
})

/** The five resource kinds. Their IDs are referenced by cards and achievements, so only how they look and read is editable. */
export function ResourcesSection({ pack, update }: { pack: Pack; update: (fn: (p: Pack) => Pack) => void }) {
  const set = (i: number, patch: Partial<Pack["resourceKinds"][number]>) =>
    update((p) => ({ ...p, resourceKinds: p.resourceKinds.map((x, j) => (j === i ? { ...x, ...patch } : x)) }))
  return (
    <div className="flex max-w-4xl flex-col gap-10">
      <Section>
        <ul className="flex flex-col divide-y rounded-lg border">
          {pack.resourceKinds.map((k, i) => (
            <li key={k.id} className="grid gap-3 p-3 sm:grid-cols-[2rem_1fr_1fr_1fr] sm:items-end">
              <ResourceDisc kind={k} size="md" />
              <TextField id={`kind-${k.id}-label`} label={`Label (${k.id})`} value={k.label} maxLength={24} onChange={(label) => set(i, { label })} />
              <SelectField
                id={`kind-${k.id}-tone`}
                label="Tone"
                value={k.tone}
                options={TONES.map((t) => ({ value: t, label: t, prefix: <span className={cn("resource-shade size-3.5 rounded-full", TONE_SOLID[t])} aria-hidden /> }))}
                onChange={(tone) => set(i, { tone: tone as Tone })}
              />
              <SelectField
                id={`kind-${k.id}-icon`}
                label="Icon"
                value={k.icon}
                options={ICON_OPTIONS}
                onChange={(icon) => set(i, { icon: icon as ResourceIcon })}
              />
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Collection artwork">
        <ResourceArtEditor pack={pack} update={update} />
      </Section>
    </div>
  )
}
