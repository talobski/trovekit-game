import { useRef, useState } from "react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { PackSummary, VersionSummary } from "@/shared/content"
import { duplicateVersion, shortDate } from "./lifecycle"
import type { Content } from "./model"

/**
 * Opening another pack would replace unsaved changes. Save draft continues only
 * if the save succeeds; a failed save keeps the admin where they are.
 */
export function LeaveDialog({ name, onSave, onChoose }: {
  /** The pack with unsaved changes; null when closed. */
  name: string | null
  onSave: () => Promise<boolean>
  onChoose: (leave: boolean) => void
}) {
  const [saving, setSaving] = useState(false)
  return (
    <AlertDialog open={name !== null} onOpenChange={(o) => !o && !saving && onChoose(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Save changes to {name}?</AlertDialogTitle>
          <AlertDialogDescription>Your unsaved changes will be lost if you leave without saving. Saved drafts and published versions are kept either way.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
          <Button variant="outline" disabled={saving} onClick={() => onChoose(true)}>Discard changes</Button>
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true)
              try { onChoose(await onSave()) } finally { setSaving(false) }
            }}
          >
            {saving ? "Saving…" : "Save draft"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** The pack changed in another tab or window since the editor loaded it. Nothing was saved. */
export function ConflictDialog({ open, onOpenChange, onOpenLatest, onReplace }: { open: boolean; onOpenChange: (o: boolean) => void; onOpenLatest: () => void; onReplace: () => void }) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>This pack changed in another tab or window</AlertDialogTitle>
          <AlertDialogDescription>
            Your changes were not saved. Open the latest version to continue from it, which discards your unsaved changes, or replace the newer draft with yours. You can also cancel and export your changes first.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="outline" onClick={onOpenLatest}>Open latest</Button>
          <Button variant="destructive" onClick={onReplace}>Replace with mine</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * An imported pack whose ID is already in the library: never guess whether it
 * updates that pack. Either choice saves a draft; a failure keeps the dialog
 * (and the import) open to try again.
 */
export function ImportChoice({ candidate, existing, onClose, onUpdate, onSeparate }: {
  candidate: Content | null
  existing: PackSummary | null
  onClose: () => void
  /** Each returns an error message, or null once saved. */
  onUpdate: (c: Content) => Promise<string | null>
  onSeparate: (c: Content) => Promise<string | null>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const close = () => {
    if (busy) return
    setError("")
    onClose()
  }
  const choose = (fn: (c: Content) => Promise<string | null>) => async () => {
    if (!candidate || busy) return
    setBusy(true)
    setError("")
    try {
      const failure = await fn(candidate)
      if (failure) setError(failure)
      else onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={!!candidate} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing?.name ?? "This pack"} is already in your library</DialogTitle>
          <DialogDescription>
            The import uses the pack ID {candidate?.pack.id}. Update that pack, which replaces its draft with the import, or create a separate pack with a new ID. Either way the import is saved as a draft; published versions are not changed.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Not imported</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={close}>Cancel</Button>
          <Button variant="outline" disabled={busy} onClick={choose(onSeparate)}>Create separate pack</Button>
          <Button disabled={busy} onClick={choose(onUpdate)}>Update {existing?.name ?? "existing pack"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Publish an immutable version. Choosing the default is a separate step: once
 * published, the dialog offers Make default, which is the only way the new
 * version reaches new rooms.
 */
export function PublishDialog({ open, onOpenChange, content, versions, defaultVersion, onPublish, onMakeDefault }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  content: Content
  versions: VersionSummary[]
  defaultVersion: VersionSummary | null
  onPublish: (note: string) => Promise<VersionSummary | null>
  onMakeDefault: (id: string) => Promise<void>
}) {
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [published, setPublished] = useState<VersionSummary | null>(null)
  // Each opening is a session. Closing ends it, so a response that arrives later never fills a dialog opened afterwards.
  const session = useRef(0)
  const latest = versions.find((v) => v.packId === content.pack.id) ?? null
  const duplicate = duplicateVersion(versions, content)
  const close = (o: boolean) => {
    if (!o) {
      session.current++
      setPublished(null)
      setBusy(false)
    }
    onOpenChange(o)
  }
  /** Runs `task` for this session; `current()` tells it whether the dialog is still the one that started it. */
  const run = async (task: (current: () => boolean) => Promise<void>) => {
    const mine = session.current
    const current = () => mine === session.current
    setBusy(true)
    try { await task(current) } catch (e) { toast.error((e as Error).message) } finally { if (current()) setBusy(false) }
  }

  if (published)
    return (
      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Published {published.packName} {published.packVersion}</DialogTitle>
            <DialogDescription>
              {!defaultVersion
                ? "No version is the default yet, so players cannot create rooms. Make this version the default to open it to new rooms."
                : defaultVersion.packId === published.packId
                  ? `New rooms still use ${defaultVersion.packVersion} until you make this version the default.`
                  : `New rooms still use ${defaultVersion.packName}. Make this version the default to switch.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => close(false)}>Not now</Button>
            <Button disabled={busy} onClick={() => run(async (current) => { await onMakeDefault(published.id); if (current()) close(false) })}>Make default</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publish {content.pack.name} {content.pack.version}</DialogTitle>
          <DialogDescription>
            {latest ? `Creates a new version after ${latest.packVersion}.` : "Creates the first version of this pack."} Published versions cannot be changed. The default for new rooms stays the same.
          </DialogDescription>
        </DialogHeader>
        {duplicate && (
          <Alert>
            <AlertTitle>Version {duplicate.packVersion} is already published</AlertTitle>
            <AlertDescription>
              It was published on {shortDate(duplicate.createdAt)} ({duplicate.note}). Change the version number in Settings so the two can be told apart, or publish anyway.
            </AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="publish-note">Note</Label>
          <Input id="publish-note" value={note} maxLength={120} placeholder="What changed" onChange={(e) => setNote(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)}>Cancel</Button>
          <Button disabled={busy} onClick={() => run(async (current) => {
            const version = await onPublish(note)
            if (!current()) {
              // Closed while publishing: the version exists, but this dialog has moved on.
              if (version) toast(`Published ${version.packName} ${version.packVersion}. Make it the default from its Versions page when ready.`)
              return
            }
            if (!version) return close(false)
            setNote("")
            setPublished(version)
          })}>
            Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
