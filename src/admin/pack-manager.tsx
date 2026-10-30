import { useEffect, useState } from "react"
import { toast } from "sonner"
import { diffContent, type Content } from "./model"
import { DraftSchema, validateContent, type ContentResult, type PackSummary, type VersionSummary } from "@/shared/content"
import type { Issue } from "@/engine/validate"
import { defaultState, packStatuses, shortDate } from "./lifecycle"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { adminApi } from "./api"
import { FormField, PageHeader, Section } from "./fields"
import { NEW_PACK, packRoute, routeHash } from "./routes"
import { ChevronDownIcon, PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Text } from "@/engine/schema"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { ResponsiveSheet } from "@/components/responsive-sheet"
import { IssueList } from "./sections/preview"
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog"

/**
 * A pack name, from which the server derives the stable pack ID. Used to
 * duplicate a pack.
 */
export function NewPackForm({ id = "new-pack-name", label = "Pack name", submit = "Create pack", busyLabel = "Creating…", autoFocus, onCreate }: {
  id?: string
  label?: string
  submit?: string
  busyLabel?: string
  autoFocus?: boolean
  /** Returns an error message, or null once the pack exists. */
  onCreate: (name: string) => Promise<string | null>
}) {
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const check = Text(48).safeParse(name)
  const nameError = name && !check.success ? check.error.issues.map((i) => (i.message === "Required" ? "Enter a pack name." : i.message)).join("; ") : ""
  const shown = error || nameError
  const run = async () => {
    if (!check.success || busy) return
    setBusy(true)
    setError("")
    try {
      const failure = await onCreate(name)
      if (failure) setError(failure)
      else setName("")
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="flex max-w-xl flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void run() }}>
      <FormField id={id} label={label} error={shown} hint="An internal ID is created from the name. You can rename the pack later.">
        <Input id={id} required maxLength={48} autoFocus={autoFocus} value={name} aria-describedby={`${id}-feedback`} aria-invalid={!!shown} onChange={(e) => { setName(e.target.value); setError("") }} />
      </FormField>
      <div><Button type="submit" disabled={!check.success || busy}>{busy ? busyLabel : submit}</Button></div>
    </form>
  )
}

/**
 * Every installed pack: its draft, latest published version and whether new
 * rooms use it, with the library-wide actions. Opening a pack is a link to its
 * workspace, so unsaved changes are protected by the navigation guard.
 */
export function LibraryPage({ packs, versions, activeId, dirtyPackId, onImport, onChanged, onMakeDefault }: {
  packs: PackSummary[]
  versions: VersionSummary[]
  activeId: string | null
  /** The pack with unsaved changes in the editor, if any. */
  dirtyPackId: string | null
  onImport: () => void
  onChanged: () => void
  onMakeDefault: (versionId: string) => Promise<void>
}) {
  const [confirm, setConfirm] = useState<{ title: string; description: string; run: () => Promise<void> } | null>(null)
  const statuses = packStatuses(packs, versions, activeId)
  const library = defaultState(packs, versions, activeId)
  return <div className="flex flex-col gap-10">
    <PageHeader
      title="Library"
      description={packs.length > 0 && "Drafts stay private. Publishing creates a version that never changes. The default is the one version new rooms use."}
      actions={packs.length > 0 && <><Button variant="outline" onClick={onImport}>Import pack</Button><Button asChild><a href={routeHash(NEW_PACK)}><PlusIcon aria-hidden />New pack</a></Button></>}
    />
    {packs.length === 0 ? (
      <section className="flex flex-col items-start gap-4 rounded-lg border border-dashed p-6 sm:p-8" aria-labelledby="first-pack">
        <div className="flex flex-col gap-1">
          <h2 id="first-pack" className="text-lg font-semibold">Create your first pack</h2>
          <p className="max-w-prose text-sm text-muted-foreground">A content pack is a complete game for Trovekit: its resources, cards, rules and achievements. Create one with the help of your AI assistant, or import a pack file you already have.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild><a href={routeHash(NEW_PACK)}><PlusIcon aria-hidden />Create pack</a></Button>
          <Button variant="outline" onClick={onImport}>Import pack</Button>
        </div>
      </section>
    ) : (
      <Section title="Content packs">
        {library.kind === "default" && <p className="text-sm">New rooms use <span className="font-medium">{library.version.packName} {library.version.packVersion}</span>.</p>}
        {library.kind === "no-default" && <Alert><AlertTitle>No default game</AlertTitle><AlertDescription>Players cannot create rooms until you make a published version the default.</AlertDescription></Alert>}
        {library.kind === "unpublished" && <p className="text-sm text-muted-foreground">Nothing is published yet. Publish a version, then make it the default so players can create rooms.</p>}
        <ul aria-label="Content packs" className="divide-y rounded-lg border">{statuses.map(({ pack: p, latest, defaultVersion, versions: own }) => {
          const canMakeDefault = !!latest && !p.archived && latest.id !== activeId
          return <li key={p.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                <span className="break-words">{p.name}</span>
                {defaultVersion && <Badge className="bg-success text-success-foreground">Default</Badge>}
                {p.archived && <Badge variant="outline">Archived</Badge>}
              </p>
              <p className="text-xs text-muted-foreground break-all">{p.id}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
                {dirtyPackId === p.id && <><dt className="text-muted-foreground">Editor</dt><dd>Unsaved changes</dd></>}
                {p.draft && <><dt className="text-muted-foreground">Draft</dt><dd>Unpublished changes</dd></>}
                <dt className="text-muted-foreground">Latest published</dt>
                <dd>{latest ? `${latest.packVersion} · ${shortDate(latest.createdAt)}` : "Not published"}</dd>
                {defaultVersion && defaultVersion.id !== latest?.id && <><dt className="text-muted-foreground">Default</dt><dd>{defaultVersion.packVersion} (older version)</dd></>}
              </dl>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button size="sm" variant={p.draft ? "default" : "outline"} asChild><a href={routeHash(packRoute(p.id))} aria-label={`${p.draft ? "Continue draft" : "Edit"}: ${p.name}`}>{p.draft ? "Continue draft" : "Edit"}</a></Button>
              {own.length > 0 && <Button size="sm" variant="outline" asChild><a href={routeHash(packRoute(p.id, "versions"))} aria-label={`Versions: ${p.name}`}>Versions</a></Button>}
              {canMakeDefault && <Button size="sm" variant="outline" aria-label={`Make default: ${p.name}`} onClick={() => setConfirm({
                title: `Make ${latest.packName} ${latest.packVersion} the default for new rooms?`,
                description: "Rooms already created keep their version. Drafts and published versions are not changed.",
                run: () => onMakeDefault(latest.id),
              })}>Make default</Button>}
              <Button variant="ghost" size="sm" aria-label={`${p.archived ? "Restore" : "Archive"}: ${p.name}`} onClick={() => setConfirm({
                title: `${p.archived ? "Restore" : "Archive"} ${p.name}?`,
                description: p.archived ? "Its published versions can be made the default again." : "Its versions can no longer be made the default. Its draft, versions and existing rooms are kept.",
                run: async () => { await adminApi.archive(p.id, !p.archived); onChanged() },
              })}>{p.archived ? "Restore" : "Archive"}</Button>
            </div>
          </li>
        })}</ul>
      </Section>
    )}
    <AlertDialog open={!!confirm} onOpenChange={o => !o && setConfirm(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirm?.title}</AlertDialogTitle><AlertDialogDescription>{confirm?.description}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { const action = confirm; setConfirm(null); action?.run().catch(e => toast.error(e.message)) }}>Continue</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>
}

/**
 * Review an import before it is applied. A full pack (no `current`) shows a
 * plain summary, with its JSON under technical details, and Import saves it.
 * A card batch (`current` is the draft it changes) lists each card change and
 * asks to confirm replacing existing cards before applying.
 */
export function ImportReview({ candidate, note, current, onClose, onApply }: {
  candidate: Content
  note: string
  current?: Content
  onClose: () => void
  /** Applies the import. A message means it failed: the review stays open, with the import, to try again. */
  onApply: (c: Content) => Promise<string | null> | void
}) {
  const [raw, setRaw] = useState(JSON.stringify(candidate, null, 2))
  const [approved, setApproved] = useState(false)
  const [missing, setMissing] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  let result: ContentResult
  let draft: Content | undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    result = validateContent(parsed)
    const checked = current ? DraftSchema.safeParse(parsed) : undefined
    if (checked?.success) draft = checked.data
  } catch(e) { result = { ok: false, issues: [{ path: "JSON", message: (e as Error).message }] } }
  const valid = result.ok ? result.content : draft
  const changes = current && valid ? diffContent(current, valid).filter(c => c.area === "Cards") : []
  const replacements = changes.filter(c => c.kind !== "added").length
  const issues = result.ok ? [] : result.issues
  const artKey = valid?.pack.cards.map(c => `${c.id}:${c.art?.src ?? ""}`).join("|")
  useEffect(() => { let cancelled = false; if (valid && result.ok) adminApi.missingAssets(valid).then(ids => { if (!cancelled) setMissing(Array.isArray(ids) ? ids : []) }).catch(() => {}); return () => { cancelled = true } }, [artKey])
  const ready = current ? !!valid && approved : result.ok
  const apply = async () => {
    if (!valid || !ready || busy) return
    setBusy(true)
    setError("")
    try {
      const failure = await onApply(valid)
      if (failure) setError(failure)
      else onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  // While the import is being saved, it stays exactly as submitted: edits would be lost when the review closes.
  const edit = (text: string) => { if (busy) return; setRaw(text); setApproved(false); setError("") }
  return <ResponsiveSheet open onOpenChange={o => !o && !busy && onClose()} title="Review import" description={note} focusBody className="sm:max-w-3xl" footer={<div className="flex items-center justify-end gap-2"><p role="status" className="mr-auto text-sm text-muted-foreground">{busy && !current ? "Saving the draft…" : ""}</p><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={!ready || busy} onClick={() => void apply()}>{current ? "Apply to editor" : busy ? "Importing…" : "Import"}</Button></div>}>
    {current ? <div className="flex flex-col gap-4">
      {valid && <div className="text-sm"><p>{valid.pack.name}: {valid.pack.cards.length} cards, {valid.pack.achievements.length} achievements, {valid.pack.relationships.length} relationships.</p><p>{valid.pack.resourceKinds.map(k => k.label).join(" · ")}</p><ul className="mt-2">{valid.pack.cardGroups.map(g => <li key={g.id}>{g.label}: {g.deckSize} cards, cost {g.cost.min}–{g.cost.max}, points {g.points.min}–{g.points.max}</li>)}</ul><p className="mt-2">{valid.pack.cards.filter(c => c.art).length} image references; {result.ok ? `${missing.length} missing local assets.` : "Image availability is checked once the pack is valid."} Missing images use initials.</p>{missing.length > 0 && <p className="break-words">{missing.join(", ")}</p>}</div>}
      {current && <>
        <p className="text-sm">{changes.filter(c => c.kind === "added").length} cards added; {replacements} existing cards changed or removed. Saved drafts and versions stay unchanged until you save.</p>
        <ul aria-label="Card changes" className="divide-y rounded-lg border text-sm">{changes.map(change => {
          const card = valid?.pack.cards.find(c => c.id === change.id)
          const resource = (id: string) => valid?.pack.resourceKinds.find(k => k.id === id)?.label ?? id
          return <li key={change.id} className="space-y-1 p-3"><p className="font-medium break-words">{card?.name ?? change.id}</p><p className="text-muted-foreground break-words">{change.id} · {change.kind}</p>{card && <><p>{valid?.pack.cardGroups.find(g => g.id === card.group)?.label ?? card.group} · {card.points} points · Contributes {resource(card.permanentResource)}</p><p className="text-muted-foreground">Cost: {Object.entries(card.cost).filter(([, n]) => n > 0).map(([id, n]) => `${n} ${resource(id)}`).join(", ") || "0"}</p></>}</li>
        })}</ul>
      </>}
      {issues.length > 0 && <div className="flex flex-col gap-2"><p className="text-sm font-medium">{valid ? "This batch can be applied to your draft. Fix these requirements before publishing." : "Fix these fields before applying the import."}</p><IssueList issues={issues} content={valid ?? candidate} /></div>}
      <Collapsible><CollapsibleTrigger asChild><Button variant="outline" size="sm">Edit import JSON</Button></CollapsibleTrigger><CollapsibleContent className="pt-3"><Label htmlFor="import-json">Edit JSON and ID mappings</Label><Textarea id="import-json" className="mt-2 min-h-64 font-mono text-xs" readOnly={busy} value={raw} onChange={e => edit(e.target.value)} /></CollapsibleContent></Collapsible>
      <div className="flex items-center gap-2"><Switch id="approve-import" disabled={busy} checked={approved} onCheckedChange={setApproved} /><Label htmlFor="approve-import">{replacements ? `Apply this batch and replace ${replacements} existing cards in my draft` : "Apply this batch to my draft"}</Label></div>
    </div> : <PackImportSummary content={result.ok ? result.content : null} issues={issues} candidate={candidate} missing={missing} error={error} raw={raw} saving={busy} onEdit={edit} />}
  </ResponsiveSheet>
}

/** What a full-pack import contains, in plain words; its JSON only on request. */
function PackImportSummary({ content, issues, candidate, missing, error, raw, saving, onEdit }: {
  /** The import as it stands, or null while its JSON has problems. */
  content: Content | null
  issues: Issue[]
  candidate: Content
  /** Card images this library does not have. */
  missing: string[]
  error: string
  raw: string
  /** The import is being saved: its JSON cannot change until that finishes. */
  saving: boolean
  onEdit: (raw: string) => void
}) {
  const pack = content?.pack
  return <div className="flex flex-col gap-5 text-sm">
    {error && <Alert variant="destructive"><AlertTitle>Not imported</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    {pack ? <>
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold break-words">{pack.name}</h3>
        {pack.description && <p className="text-muted-foreground break-words">{pack.description}</p>}
      </div>
      <dl aria-label="Pack contents" className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2">
        <dt className="text-muted-foreground">Cards</dt>
        <dd>
          {pack.cards.length}
          <ul className="text-muted-foreground">{pack.cardGroups.map(g => <li key={g.id}>{g.label}: {pack.cards.filter(c => c.group === g.id).length}</li>)}</ul>
        </dd>
        <dt className="text-muted-foreground">Resources</dt>
        <dd className="break-words">{pack.resourceKinds.map(k => k.label).join(", ")}</dd>
        <dt className="text-muted-foreground">Achievements</dt>
        <dd>{pack.achievements.length}</dd>
        <dt className="text-muted-foreground">Relationships</dt>
        <dd>{pack.relationships.length}</dd>
      </dl>
      {missing.length > 0 && <p role="status" className="text-muted-foreground">{missing.length === 1 ? "1 card image is" : `${missing.length} card images are`} not in this library. Those cards show initials until you upload images.</p>}
    </> : <div className="flex flex-col gap-2">
      <p className="font-medium text-destructive">Fix these fields in the technical details before importing.</p>
      <IssueList issues={issues} content={candidate} />
    </div>}
    <Collapsible defaultOpen={!content}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="group -ml-3">
          View technical details
          <ChevronDownIcon className="transition-transform group-data-[state=open]:rotate-180" aria-hidden />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 pt-2">
        {pack && <p className="text-muted-foreground">Pack ID {pack.id}, version {pack.version}. Edit the JSON to correct IDs or fields; the summary follows your changes.</p>}
        <Label htmlFor="import-json">Pack JSON</Label>
        <Textarea id="import-json" className="min-h-64 font-mono text-xs" readOnly={saving} aria-describedby={saving ? "import-json-saving" : undefined} value={raw} onChange={e => onEdit(e.target.value)} />
        {saving && <p id="import-json-saving" className="text-muted-foreground">The JSON can be edited again if saving fails.</p>}
      </CollapsibleContent>
    </Collapsible>
  </div>
}
