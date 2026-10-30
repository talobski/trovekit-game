import { useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import type { PackSummary } from "@/shared/content"
import type { VersionSummary } from "../api"
import { Section } from "../fields"
import type { Change } from "../model"

export function ChangeList({ changes, empty }: { changes: Change[]; empty: string }) {
  if (!changes.length) return <p className="text-sm text-muted-foreground">{empty}</p>
  return (
    <ScrollArea type="auto" className="rounded-lg border" viewportClassName="max-h-96" viewportProps={{ tabIndex: 0, role: "region", "aria-label": "Changes" }}>
      <ul className="flex flex-col divide-y text-sm">
        {changes.map((c, i) => (
          <li key={i} className="grid gap-1 px-3 py-2 sm:grid-cols-[8rem_5rem_1fr]">
            <span className="text-muted-foreground">{c.area}</span>
            <span className={cn("font-medium", c.kind === "added" && "text-success", c.kind === "removed" && "text-destructive")}>{c.kind}</span>
            <span className="min-w-0 break-words">
              <span className="font-mono text-xs">{c.id}</span> {c.detail}
            </span>
          </li>
        ))}
      </ul>
    </ScrollArea>
  )
}

export function VersionsSection({
  packId,
  packs,
  versions,
  active,
  changesFromLatest,
  compare,
  onLoad,
  onActivate,
  onCompare,
}: {
  /** The pack open in the editor. */
  packId: string
  packs: PackSummary[]
  versions: VersionSummary[]
  active: string | null
  /** Editor compared with the open pack's latest published version; null when it has none. */
  changesFromLatest: Change[] | null
  compare: { id: string; changes: Change[] } | null
  onLoad: (id: string) => void
  onActivate: (id: string) => void
  onCompare: (id: string) => void
}) {
  const [confirmAction, setConfirmAction] = useState<{ title: string; description: string; run: () => void } | null>(null)
  // History is per pack; the sidebar moves between packs.
  const list = versions.filter((v) => v.packId === packId)
  const archived = packs.find((p) => p.id === packId)?.archived ?? false
  const latestOfShown = packs.find((p) => p.id === packId)?.published ?? null
  const defaultVersion = versions.find((v) => v.id === active) ?? null
  return (
    <div className="flex flex-col gap-10">
      <Section title="Unpublished changes" description="What publishing the editor would add to this pack's latest published version.">
        {changesFromLatest ? <ChangeList changes={changesFromLatest} empty="The editor matches the latest published version." /> : <p className="text-sm text-muted-foreground">This pack has no published version yet. Publishing creates its first one.</p>}
        <p className="text-sm text-muted-foreground">
          {defaultVersion ? <>New rooms use {defaultVersion.packName} {defaultVersion.packVersion}.</> : "No version is the default yet. Players cannot create rooms until you make one the default."}
        </p>
      </Section>

      <Section
        title="Published versions"
        description="Published versions never change. New rooms use the default version; existing rooms keep the version they were created with."
      >
        {list.length === 0 && <p className="text-sm text-muted-foreground">No versions published yet.</p>}
        <ul aria-label="Published versions" className={cn("flex flex-col divide-y rounded-lg border", !list.length && "hidden")}>
          {list.map((v) => (
            <li key={v.id} className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  <span className="break-words">{v.packVersion} · {v.note}</span>
                  {v.id === active && <Badge className="bg-success text-success-foreground">Default</Badge>}
                  {v.id === latestOfShown && <Badge variant="outline">Latest</Badge>}
                </span>
                <span className="text-xs text-muted-foreground break-all">
                  {v.packName} · target {v.targetPoints} · {new Date(v.createdAt).toLocaleString()} · {v.id}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => onCompare(v.id)}>
                  Compare
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmAction({ title: `Load ${v.packVersion} into the editor?`, description: "It replaces unsaved editor changes. Your saved draft is kept until you save again.", run: () => onLoad(v.id) })}>
                  Load into editor
                </Button>
                {v.id !== active && !archived && (
                  <Button size="sm" variant="outline" onClick={() => setConfirmAction({ title: `Make ${v.packName} ${v.packVersion} the default for new rooms?`, description: v.id === latestOfShown ? "Rooms already created keep their version. Drafts and published versions are not changed." : "This is an older version (a rollback). The latest published version, drafts and existing rooms are not changed.", run: () => onActivate(v.id) })}>
                    Make default
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {archived && list.length > 0 && <p className="text-sm text-muted-foreground">This pack is archived. Restore it in Settings to make one of its versions the default.</p>}
      </Section>

      {compare && (
        <Section title={`Editor compared with ${versions.find((v) => v.id === compare.id)?.packVersion ?? compare.id}`}>
          <ChangeList changes={compare.changes} empty="No differences." />
        </Section>
      )}

      <AlertDialog open={!!confirmAction} onOpenChange={o => !o && setConfirmAction(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirmAction?.title}</AlertDialogTitle><AlertDialogDescription>{confirmAction?.description}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { confirmAction?.run(); setConfirmAction(null) }}>Continue</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </div>
  )
}
