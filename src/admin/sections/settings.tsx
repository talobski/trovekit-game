import { useState } from "react"
import { toast } from "sonner"
import type { Labels, Pack } from "@/engine/schema"
import { LABEL_DEFAULTS } from "@/engine/text"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import type { PackSummary } from "@/shared/content"
import { adminApi } from "../api"
import { FormField, Section, SelectField, TextField } from "../fields"
import { ICON_OPTIONS } from "./resources"
import type { ResourceIcon } from "@/engine/schema"
import { cardManifest, download } from "../images"
import type { Content } from "../model"
import { NewPackForm } from "../pack-manager"

const LABEL_KEYS: { key: keyof Labels; label: string }[] = [
  { key: "game", label: "Game title" },
  { key: "collect", label: "Collect action" },
  { key: "collected", label: "Collect action, past tense" },
  { key: "reserve", label: "Reserve action" },
  { key: "acquire", label: "Acquire action" },
  { key: "resource", label: "Resource (one)" },
  { key: "resources", label: "Resources (many)" },
  { key: "wildcard", label: "Wildcard (one)" },
  { key: "wildcards", label: "Wildcards (many)" },
  { key: "reserved", label: "Reserved area" },
  { key: "acquired", label: "Acquired area" },
  { key: "points", label: "Points" },
  { key: "collection", label: "Player collection" },
  { key: "achievements", label: "Achievements" },
  { key: "card", label: "Card noun (one)" },
  { key: "cards", label: "Card noun (many)" },
]

/** Hints for labels with special behaviour. */
const LABEL_HINTS: Partial<Record<keyof Labels, string>> = {
  collect: "e.g. “Collect {label:resources}”. {label:resources} inserts the Resources label.",
  collected: "For the activity log, e.g. “Collected {label:resources}”.",
  reserved: "Also the reserve action in the past tense.",
  acquired: "Also the acquire action in the past tense.",
}

/** Optional labels: blank removes the key so the pack falls back to the generic default. */
const OPTIONAL_HINTS: Partial<Record<keyof Labels, string>> = {
  card: `Optional, e.g. Hero. Blank uses "${LABEL_DEFAULTS.card}".`,
  cards: `Optional, e.g. Heroes. Blank uses "${LABEL_DEFAULTS.cards}".`,
}

/** The select's value for a pack without an icon (select values cannot be empty). */
const NO_ICON = "none"

export function SettingsSection({ content, summary, update, onExport, onImport, onDuplicate, onArchive }: {
  content: Content
  /** The pack's library entry; null for an imported pack that is not saved yet. */
  summary: PackSummary | null
  update: (fn: (p: Pack) => Pack) => void
  onExport: () => void
  onImport: () => void
  /** Create a separate pack from the editor content. Returns an error message, or null. */
  onDuplicate: (name: string) => Promise<string | null>
  onArchive: (archived: boolean) => Promise<void>
}) {
  const { pack } = content
  const [confirmArchive, setConfirmArchive] = useState(false)
  const exportBundle = async () => {
    try {
      const blob = await adminApi.exportBundle(content)
      const a = document.createElement("a")
      a.href = URL.createObjectURL(blob)
      a.download = `${pack.id}.zip`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  return (
    <div className="flex max-w-4xl flex-col gap-10">
      <Section title="Pack">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField id="pack-name" label="Name" value={pack.name} maxLength={48} onChange={(name) => update((p) => ({ ...p, name }))} />
          <TextField id="pack-version" label="Version" value={pack.version} hint="Like 1.2.0. Set it before publishing so versions can be told apart." onChange={(version) => update((p) => ({ ...p, version }))} />
          <SelectField
            id="pack-icon"
            label="Icon"
            value={pack.icon ?? NO_ICON}
            hint="Shown beside the Game title on the home page and in rooms."
            options={[{ value: NO_ICON, label: "No icon" }, ...ICON_OPTIONS]}
            onChange={(icon) => update((p) => ({ ...p, icon: icon === NO_ICON ? undefined : (icon as ResourceIcon) }))}
          />
          <FormField id="pack-description" label="Description" className="sm:col-span-2">
            <Textarea id="pack-description" value={pack.description ?? ""} maxLength={300} onChange={(e) => update((p) => ({ ...p, description: e.target.value || undefined }))} />
          </FormField>
          <p className="text-sm text-muted-foreground sm:col-span-2">
            Pack ID <span className="font-mono text-foreground break-all">{pack.id}</span>. It never changes, so renaming the pack is safe.
          </p>
        </div>
      </Section>

      <Section title="Terminology" description="Words the game uses for its actions and areas.">
        <div className="grid gap-4 sm:grid-cols-3">
          {LABEL_KEYS.map(({ key, label }) => (
            <TextField
              key={key}
              id={`label-${key}`}
              label={label}
              value={pack.labels[key] ?? ""}
              hint={LABEL_HINTS[key] ?? OPTIONAL_HINTS[key]}
              maxLength={key === "collect" || key === "collected" ? 40 : 32}
              onChange={(v) =>
                update((p) => {
                  const labels = { ...p.labels, [key]: v }
                  if (key in OPTIONAL_HINTS && !v.trim()) delete labels[key]
                  return { ...p, labels }
                })
              }
            />
          ))}
        </div>
      </Section>

      <Section title="Files" description="Exports include unsaved changes. Importing a pack file asks before it changes anything.">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onExport}>Export JSON</Button>
          <Button variant="outline" onClick={() => void exportBundle()}>Export with images</Button>
          <Button variant="outline" onClick={() => download(`${pack.id}-card-ids.json`, JSON.stringify(cardManifest(pack), null, 2))}>Card-ID manifest</Button>
          <Button variant="outline" onClick={onImport}>Import pack file</Button>
        </div>
      </Section>

      <Section title="Duplicate" description="Creates a separate pack with a new ID from this editor content, including unsaved changes.">
        <NewPackForm id="duplicate-pack-name" label="New pack name" submit="Duplicate pack" busyLabel="Duplicating…" onCreate={onDuplicate} />
      </Section>

      {summary && (
        <Section
          title={summary.archived ? "Archived" : "Archive"}
          description={summary.archived ? "Its versions cannot be made the default for new rooms. Restoring allows that again." : "Archiving stops this pack's versions from being made the default. Its draft, versions and existing rooms are kept."}
        >
          <div>
            <Button variant="outline" onClick={() => setConfirmArchive(true)}>{summary.archived ? "Restore pack" : "Archive pack"}</Button>
          </div>
          <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{summary.archived ? "Restore" : "Archive"} {summary.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  {summary.archived ? "Its published versions can be made the default again." : "Its versions can no longer be made the default. Its draft, versions and existing rooms are kept."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => void onArchive(!summary.archived).catch((e) => toast.error((e as Error).message))}>{summary.archived ? "Restore" : "Archive"}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </Section>
      )}
    </div>
  )
}
