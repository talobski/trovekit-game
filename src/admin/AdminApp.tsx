import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { LoaderCircleIcon } from "lucide-react"
import { toast } from "sonner"
import type { Issue } from "@/engine/validate"
import { validateContent, type PackSummary } from "@/shared/content"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { readStored, removeStored, writeStored } from "@/lib/storage"
import { defaultRules } from "../../content/index.ts"
import { AdminSidebar } from "./admin-sidebar"
import { adminApi, ConflictError, type VersionSummary } from "./api"
import { CreatePackPage, type Creation } from "./create-pack"
import { ConflictDialog, ImportChoice, LeaveDialog, PublishDialog } from "./dialogs"
import { PageHeader } from "./fields"
import { diffContent, parseImport, type Change, type Content } from "./model"
import { ImportReview, LibraryPage } from "./pack-manager"
import { LIBRARY, packRoute, routeHash, SECTION_LABEL, type Route, type Section } from "./routes"
import { AchievementsSection } from "./sections/achievements"
import { CardsSection } from "./sections/cards"
import { OverviewSection } from "./sections/overview"
import { IssueList, PreviewSection } from "./sections/preview"
import { RelationshipsSection } from "./sections/relationships"
import { ResourcesSection } from "./sections/resources"
import { RulesSection } from "./sections/rules"
import { SettingsSection } from "./sections/settings"
import { VersionsSection } from "./sections/versions"
import { useEditor, type Opened, type Ticket } from "./use-editor"
import { useNavigation } from "./use-navigation"
import { isMissingCards, publishingStatus } from "./validation"

export type { Opened }

interface Library {
  packs: PackSummary[]
  versions: VersionSummary[]
  /** The default version (new rooms use it), or null. */
  active: string | null
}

const LAST_PACK = "admin-pack"
const remembered = () => { try { return readStored(LAST_PACK) } catch { return null } }
const remember = (id: string) => { try { writeStored(LAST_PACK, id) } catch { /* per-browser convenience only */ } }
const forget = (id: string) => { try { if (readStored(LAST_PACK) === id) removeStored(LAST_PACK) } catch { /* per-browser convenience only */ } }

const DESCRIPTIONS: Partial<Record<Section, string>> = {
  resources: "Exactly five kinds. Their IDs are used by cards and achievements, so only the label, tone and icon change here. Each kind needs its own icon.",
  rules: "Changes reach new rooms once published and made the default. Existing rooms keep their version.",
  achievements: "Checked in this order after every turn. Rooms draw a subset at setup.",
  relationships: "Verified groups of 2 or 3 tiered cards, used by history achievements. Keep a source for each.",
  preview: "How your resources, cards and achievements look to players.",
}

export function AdminApp() {
  const [library, setLibrary] = useState<Library | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const editor = useEditor()
  const { opened, draft, dirty, issues } = editor
  const [savingDraft, setSavingDraft] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  /** The creation page's fields. Kept while a pack file is reviewed; cleared on leaving the page. */
  const [creation, setCreation] = useState<Creation>({ name: "", description: "" })
  const [importIssues, setImportIssues] = useState<{ message: string; issues: Issue[] } | null>(null)
  const [compare, setCompare] = useState<{ id: string; changes: Change[] } | null>(null)
  /** A full-pack import being reviewed; `name` is the name entered on the creation page, for a separate pack. */
  const [review, setReview] = useState<{ content: Content; note: string; name?: string; selection: number } | null>(null)
  /** A save or publish was refused because the pack changed elsewhere; `revision` is the pack's current one. */
  const [conflict, setConflict] = useState<{ since: Ticket; revision: string | null } | null>(null)
  /** An import whose pack ID already exists in the library, waiting for Update or Create separate (`name` names a separate pack). */
  const [importChoice, setImportChoice] = useState<{ content: Content; name: string } | null>(null)
  /** The import the admin was told would replace a draft saved in another tab; choosing Update again confirms it. */
  const replaceNewer = useRef<Content | null>(null)
  /** The latest file chosen for import: a slower read of an earlier file is dropped. */
  const fileSelection = useRef(0)
  const [latest, setLatest] = useState<{ id: string; content: Content } | null>(null)
  /** Waiting for Save draft / Discard / Cancel before another pack replaces the editor. */
  const [leave, setLeave] = useState<{ name: string; resolve: (leave: boolean) => void } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const libraryRef = useRef(library)
  libraryRef.current = library

  // Refreshes can finish out of order; only the newest one updates the library.
  const refreshes = useRef(0)
  const refresh = useCallback(async () => {
    const id = ++refreshes.current
    const [list, packs] = await Promise.all([adminApi.list(), adminApi.packs()])
    if (id === refreshes.current) setLibrary({ packs, versions: list.versions, active: list.active })
  }, [])

  useEffect(() => {
    refresh().catch((e) => setLoadError((e as Error).message))
  }, [refresh])

  // With no location in the URL, reopen the last pack, else the default's pack. An empty library starts on the library.
  const start = useCallback((): Route => {
    const lib = libraryRef.current
    const ids = lib?.packs.map((p) => p.id) ?? []
    const defaultPack = lib?.versions.find((v) => v.id === lib.active)?.packId
    const id = [remembered(), defaultPack].find((p) => p && ids.includes(p))
    return id ? packRoute(id) : LIBRARY
  }, [])
  const confirmLeave = useCallback(() => new Promise<boolean>((resolve) => {
    const name = editor.current.current.draft?.pack.name ?? "this pack"
    setLeave((previous) => {
      previous?.resolve(false)
      return { name, resolve }
    })
  }), [editor.current])
  /** A pack could not be opened: say which, and stop reopening it on the next visit. */
  const onUnavailable = useCallback((id: string, reason: string | null) => {
    forget(id)
    const name = libraryRef.current?.packs.find((p) => p.id === id)?.name
    toast.error(reason === null ? `There is no pack "${id}" in your library.` : `Could not open ${name ?? id}: ${reason}`)
  }, [])
  const packIds = useCallback(() => libraryRef.current?.packs.map((p) => p.id) ?? [], [])
  const { route, loading, navigate, position } = useNavigation({ editor, ready: !!library, packIds, start, confirmLeave, onUnavailable })
  const creating = route?.page === "new"
  const routeRef = useRef(route)
  routeRef.current = route
  useEffect(() => {
    if (!creating) setCreation({ name: "", description: "" })
  }, [creating])

  /*
   * Async results that would replace the editor, open a pack or show a dialog
   * about one apply only if the admin has neither navigated nor changed the
   * editor since the work started. Otherwise they are dropped (with a message
   * when the admin should know), so a late response never overwrites another
   * pack or unsaved work.
   */
  const begin = () => ({ editor: editor.ticket(), nav: position() })
  const still = (t: ReturnType<typeof begin>) => editor.unchanged(t.editor) && position() === t.nav

  /** Before something other than navigation replaces the editor with another pack. */
  const leaveFor = (packId: string | null) => {
    const now = editor.current.current
    return !now.dirty || (packId !== null && now.opened?.packId === packId) ? Promise.resolve(true) : confirmLeave()
  }

  useEffect(() => {
    if (opened && opened.source !== "new") remember(opened.packId)
  }, [opened])
  // Transient comparisons and dialogs belong to one pack.
  useEffect(() => {
    setCompare(null)
    setPublishOpen(false)
  }, [opened?.packId])

  // The open pack's latest published version: what publishing the editor would change.
  const latestId = library?.packs.find((p) => p.id === opened?.packId)?.published ?? null
  useEffect(() => {
    let cancelled = false
    if (!latestId) setLatest(null)
    else adminApi.get(latestId).then((content) => !cancelled && setLatest({ id: latestId, content }), () => !cancelled && setLatest(null))
    return () => { cancelled = true }
  }, [latestId])
  const changesFromLatest = useMemo(() => (draft && latest ? diffContent(latest.content, draft) : null), [latest, draft])

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  // Navigation moves focus to the new page's heading (not on the first page).
  const routeKey = route ? routeHash(route) : null
  const firstRoute = useRef(true)
  const pendingFocus = useRef(false)
  useEffect(() => {
    if (!routeKey) return
    if (firstRoute.current) firstRoute.current = false
    else pendingFocus.current = true
  }, [routeKey])
  const workspaceReady = route?.page === "pack" && opened?.packId === route.packId && !!draft
  useEffect(() => {
    if (!pendingFocus.current) return
    const heading = document.getElementById("page-title")
    if (!heading) return
    pendingFocus.current = false
    heading.focus({ preventScroll: true })
    window.scrollTo({ top: 0 })
  })

  if (loadError)
    return (
      <main className="mx-auto max-w-form p-6">
        <Alert variant="destructive">
          <AlertTitle>Could not load content</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      </main>
    )
  if (!library || !route)
    return (
      <main className="flex min-h-dvh items-center justify-center gap-2 text-muted-foreground" role="status">
        <LoaderCircleIcon className="size-4 animate-spin" /> Loading content
      </main>
    )

  const { packs, versions, active } = library
  const summary = packs.find((p) => p.id === opened?.packId) ?? null
  const defaultVersion = versions.find((v) => v.id === active) ?? null

  /** Problems saving or publishing. Shown as dialogs only in the editor instance that started the work (`since`). */
  const reportSaveError = (e: unknown, since: Ticket, name: string) => {
    if (!editor.sameInstance(since)) toast.error(`${name} was not saved: ${(e as Error).message}`)
    else if (e instanceof ConflictError) setConflict({ since, revision: e.revision })
    else toast.error((e as Error).message)
  }
  const reportIssues = (message: string, issues: Issue[], since: Ticket, name: string) => {
    if (editor.sameInstance(since)) setImportIssues({ message, issues })
    else toast.error(`${name} was not saved: ${issues.length} ${issues.length === 1 ? "problem" : "problems"} to fix.`)
  }

  /** Save the editor as the pack's one draft (over `over`, else the revision it loaded). True once saved. */
  const saveDraft = async (over?: string | null): Promise<boolean> => {
    const { draft, opened } = editor.current.current
    if (!draft || !opened || savingDraft) return false
    const since = editor.ticket()
    setSavingDraft(true)
    try {
      const result = await editor.persistDraft(structuredClone(draft), over === undefined ? opened.revision : over, since)
      if (!result.ok) {
        reportIssues("Fix these fields before saving your draft.", result.issues, since, draft.pack.name)
        return false
      }
      toast("Draft saved. It stays private until you publish a version.")
      void refresh()
      return true
    } catch (e) {
      reportSaveError(e, since, draft.pack.name)
      return false
    } finally {
      setSavingDraft(false)
    }
  }

  /** Publish exactly the editor content. Unsaved changes are saved to the draft first, so the published draft is cleared. */
  const publish = async (note: string): Promise<VersionSummary | null> => {
    const { draft, opened, dirty } = editor.current.current
    if (!draft || !opened) return null
    const snapshot = structuredClone(draft)
    const since = editor.ticket()
    try {
      let revision = opened.revision
      if (dirty || opened.source === "new") {
        const saved = await editor.persistDraft(snapshot, opened.revision, since)
        if (!saved.ok) { reportIssues("Fix these fields before saving your draft.", saved.issues, since, snapshot.pack.name); return null }
        revision = saved.revision
      }
      const res = await adminApi.publish(snapshot, note, revision)
      if (!res.ok) { reportIssues("The server rejected this content.", res.issues, since, snapshot.pack.name); return null }
      editor.markPublished(snapshot, res.version.hash, res.version.id, since)
      await refresh()
      return res.version
    } catch (e) { reportSaveError(e, since, snapshot.pack.name); return null }
  }

  const makeDefault = async (id: string) => {
    try {
      await adminApi.activate(id)
      await refresh()
      const v = versions.find((x) => x.id === id)
      toast(v ? `New rooms now use ${v.packName} ${v.packVersion}` : "Default updated")
    } catch (e) { toast.error((e as Error).message) }
  }

  /**
   * Create a pack from a name (from the blank template, or from `from`) and open its Overview. Returns an error message, or null.
   * If the admin moved on or changed the editor meanwhile, the pack is still created but not opened.
   */
  const createPack = async (name: string, from?: Content): Promise<string | null> => {
    if (!(await leaveFor(null))) return "Nothing was created. Your changes are still open."
    const t = begin()
    const res = await adminApi.createDraft(name, from)
    if (!res.ok) return res.issues.map((i) => i.message).join("; ")
    if (!still(t)) {
      void refresh()
      toast(`Created ${res.content.pack.name}. Open it from the sidebar.`)
      return null
    }
    editor.openNew(res.content, res.revision)
    void refresh()
    // A pack made on the creation page takes its place in the history: Back returns to where creating started.
    await navigate(packRoute(res.content.pack.id), { opened: true, replace: fromCreation() })
    toast(from ? `Created ${res.content.pack.name} with the ID ${res.content.pack.id}` : "Pack created")
    return null
  }

  const load = async (id: string) => {
    if (!opened) return
    const t = begin()
    const content = await adminApi.get(id)
    if (!still(t)) return toast(`${id} was not loaded because the editor changed while it was loading.`)
    if (content.pack.id !== opened.packId) return toast.error("That version belongs to another pack")
    // The loaded content becomes unsaved changes over the pack's current draft or latest version.
    editor.replace(content)
    setCompare(null)
    toast(`Loaded ${id} into the editor. Save the draft to keep it.`)
  }

  /** The admin is on the creation page, where an import opens a new pack rather than replacing the editor. */
  const fromCreation = () => routeRef.current?.page === "new"

  const onImport = async (file: File) => {
    const t = begin()
    const selection = ++fileSelection.current
    const create = creating ? { name: creation.name.trim() } : null
    const rules = create ? defaultRules : draft?.rules ?? defaultRules
    /** The review, worded for where the import was chosen. */
    const reviewOf = (content: Content) => {
      const renamed = create?.name && create.name !== content.pack.name
        ? ` This file names the pack ${content.pack.name}, not ${create.name}. It keeps the file's name, which you can change in Settings.`
        : ""
      return { content, note: `Importing saves this pack as a draft and opens it. Nothing is published.${renamed}`, name: create?.name, selection }
    }
    // Reading or unpacking the file takes time; its review belongs to where the admin chose it.
    const show = (next: () => void) => {
      if (selection !== fileSelection.current) return
      if (still(t)) next()
      else toast(`${file.name} was not opened because you moved on. Import it again.`)
    }
    try {
      if (file.name.toLowerCase().endsWith(".zip")) {
        const content = await adminApi.importBundle(file)
        return show(() => setReview(reviewOf(content)))
      }
      if (file.size > 1024 * 1024) throw new Error("File is larger than 1 MB")
      const parsed = parseImport(await file.text(), rules)
      if (!parsed.ok) throw new Error(parsed.message)
      const checked = validateContent(parsed.content)
      if (!checked.ok) return show(() => setImportIssues({ message: `${file.name} was not imported.`, issues: checked.issues }))
      show(() => setReview(reviewOf(checked.content)))
    } catch (e) { show(() => setImportIssues({ message: (e as Error).message, issues: [] })) }
  }

  /** Why a save made for an import failed, in words that say how to try again. */
  const importFailure = (e: unknown, name: string) =>
    e instanceof ConflictError
      ? `${name} changed in another tab or window while importing, so nothing was imported. Try again to import over the latest version.`
      : `${name} was not imported: ${(e as Error).message} Your file is still here, so you can try again.`
  const issuesFailure = (issues: Issue[], name: string) => {
    if (issues.some((i) => i.path === "pack.id" && /already exists/.test(i.message))) {
      void refresh()
      return `${name} was added to your library meanwhile, so nothing was imported. Choose Import again to update it or create a separate pack.`
    }
    return `${name} was not imported: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`
  }
  /** Asked before an import replaces the editor; a refusal leaves everything as it was. */
  const NOT_LEFT = "Nothing was imported. Your unsaved changes are still open."

  /**
   * A full-pack import with a pack ID not in the library: saved as that pack's
   * first draft, then opened. Returns an error message (nothing opened, the
   * review stays for a retry), or null. A save that finishes after the admin
   * moved on is kept, but not opened.
   */
  const importAsNew = async (content: Content): Promise<string | null> => {
    const name = content.pack.name
    if (!(await leaveFor(null))) return NOT_LEFT
    const t = begin()
    try {
      const saved = await adminApi.saveDraft(content, null)
      if (!saved.ok) return issuesFailure(saved.issues, name)
      void refresh()
      if (!still(t)) {
        toast(`Imported ${name} and saved it as a draft. Open it from the sidebar.`)
        return null
      }
      editor.openNew(content, saved.revision)
      await navigate(packRoute(content.pack.id), { opened: true, replace: fromCreation() })
      toast(`Imported ${name} and saved it as a draft.`)
      return null
    } catch (e) { return importFailure(e, name) }
  }

  /**
   * Update an installed pack: the import is saved as its draft over the
   * revision the admin last saw, then opened. Unsaved changes in the editor are
   * confirmed first. If the admin moves on while the pack is being read, nothing
   * is saved; a save that finishes after they moved on is kept, but not opened.
   */
  const importAsUpdate = async (content: Content): Promise<string | null> => {
    const id = content.pack.id
    const existing = libraryRef.current?.packs.find((p) => p.id === id)?.name ?? content.pack.name
    if (!(await leaveFor(null))) return NOT_LEFT
    const t = begin()
    try {
      const head = await adminApi.head(id)
      if (!still(t)) {
        toast(`The import into ${head.content.pack.name} was not applied because the editor changed meanwhile. Import it again.`)
        return null
      }
      // The pack changed in another tab or window since the editor opened it: say so once; choosing Update again replaces that newer draft.
      const now = editor.current.current.opened
      if (now?.packId === id && now.revision && now.revision !== head.revision && replaceNewer.current !== content) {
        replaceNewer.current = content
        return `${existing} changed in another tab or window since you opened it, so nothing was imported. Choose Update again to replace that newer draft with the import, or Cancel.`
      }
      replaceNewer.current = null
      // Saved over the revision just read: a change saved elsewhere in the meantime is a conflict, never overwritten.
      const saved = await adminApi.saveDraft(content, head.revision)
      if (!saved.ok) return issuesFailure(saved.issues, existing)
      void refresh()
      if (!still(t)) {
        toast(`Imported into ${existing} and saved it as a draft. Open it from the sidebar.`)
        return null
      }
      editor.showHead({ content, revision: saved.revision, source: "draft", versionId: null })
      await navigate(packRoute(id), { opened: true, replace: fromCreation() })
      toast(`Imported into ${existing} and saved it as a draft.`)
      return null
    } catch (e) { return importFailure(e, existing) }
  }

  const exportJson = () => {
    if (!draft) return
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `trovekit-${draft.pack.id}-${draft.pack.version}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  /** After a conflict: replace the editor with the pack's newer saved state, unless the admin moved on meanwhile. */
  const reopen = async (packId: string) => {
    const t = begin()
    try {
      const head = await adminApi.head(packId)
      if (!still(t)) return toast(`The latest ${head.content.pack.name} was not opened because the editor changed meanwhile.`)
      editor.showHead(head)
    } catch (e) { toast.error((e as Error).message) }
  }

  const compareWith = async (id: string) => {
    if (!draft) return
    const t = begin()
    const content = await adminApi.get(id)
    if (still(t)) setCompare({ id, changes: diffContent(content, editor.current.current.draft ?? draft) })
  }

  const go = (section: Section) => { if (opened) void navigate(packRoute(opened.packId, section)) }

  const workspace = workspaceReady && route.page === "pack" && draft && opened ? (
    <div key={opened.packId} className="flex flex-col gap-8">
      <PageHeader
        title={route.section === "overview" ? draft.pack.name : SECTION_LABEL[route.section]}
        description={route.section === "overview" ? draft.pack.description
          : route.section === "cards" ? `${draft.pack.cards.length} cards in this draft. Select any card to edit it.`
            : DESCRIPTIONS[route.section]}
      />
      {route.section === "overview" && (
        <OverviewSection
          content={draft}
          issues={issues}
          summary={summary}
          versions={versions.filter((v) => v.packId === opened.packId)}
          defaultVersion={defaultVersion}
          dirty={dirty}
          savedDraft={!!summary?.draft}
          changesFromLatest={changesFromLatest}
          onNavigate={go}
          onMakeDefault={makeDefault}
        />
      )}
      {route.section === "cards" && <CardsSection content={draft} update={editor.updatePack} issuePaths={new Set(issues.map((i) => i.path))} batch={{ begin: editor.ticket, current: editor.unchanged, apply: editor.replace }} />}
      {route.section === "resources" && <ResourcesSection pack={draft.pack} update={editor.updatePack} />}
      {route.section === "rules" && <RulesSection rules={draft.rules} pack={draft.pack} update={editor.updateRules} />}
      {route.section === "achievements" && <AchievementsSection pack={draft.pack} update={editor.updatePack} />}
      {route.section === "relationships" && <RelationshipsSection pack={draft.pack} update={editor.updatePack} />}
      {route.section === "versions" && (
        <VersionsSection
          packId={opened.packId}
          packs={packs}
          versions={versions}
          active={active}
          changesFromLatest={changesFromLatest}
          compare={compare}
          onLoad={(id) => void load(id).catch((e) => toast.error((e as Error).message))}
          onActivate={makeDefault}
          onCompare={(id) => void compareWith(id).catch((e) => toast.error((e as Error).message))}
        />
      )}
      {route.section === "preview" && <PreviewSection content={draft} issues={issues} onNavigate={go} />}
      {route.section === "settings" && (
        <SettingsSection
          content={draft}
          summary={summary}
          update={editor.updatePack}
          onExport={exportJson}
          onImport={() => fileRef.current?.click()}
          onDuplicate={(name) => createPack(name, structuredClone(draft))}
          onArchive={async (archived) => { await adminApi.archive(opened.packId, archived); await refresh() }}
        />
      )}
    </div>
  ) : null

  const errors = draft ? issues.filter((i) => !isMissingCards(i, draft)) : []

  return (
    <>
      {creating ? (
        <CreatePackPage
          value={creation}
          onChange={setCreation}
          packIds={packs.map((p) => p.id)}
          onImport={() => fileRef.current?.click()}
          onCreate={(name) => createPack(name)}
        />
      ) : (
        <SidebarProvider>
          <AdminSidebar
            route={route}
            packs={packs}
            versions={versions}
            activeId={active}
            editor={opened && draft ? { packId: opened.packId, name: draft.pack.name, dirty, unsaved: opened.source === "new" } : null}
          />
          <SidebarInset>
            <header className="sticky top-0 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-background/95 px-4 py-2.5 backdrop-blur md:px-6">
              <SidebarTrigger className="-ml-2" />
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                {workspace && draft && opened ? (
                  <>
                    <span className="font-medium text-foreground">{draft.pack.name}</span> · {openedLabel(opened, versions)}
                    {dirty && <span className="font-medium text-foreground"> · Unsaved changes</span>}
                  </>
                ) : (
                  // The sidebar names the admin on wider screens; on phones it is a closed sheet.
                  <span className="type-heading text-base text-foreground md:hidden">Trovekit Game Admin</span>
                )}
              </span>
              {workspace && draft && (
                <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
                  <p id="publishing-status" className="mr-auto flex flex-wrap items-center gap-x-2 text-xs sm:mr-1 sm:justify-end" aria-live="polite">
                    <span className={errors.length ? "text-destructive" : "text-muted-foreground"}>{publishingStatus(draft, issues)}</span>
                    {issues.length > 0 && route.page === "pack" && route.section !== "overview" && (
                      <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => go("overview")}>Review requirements</Button>
                    )}
                  </p>
                  <Button variant="outline" size="sm" disabled={savingDraft} onClick={() => void saveDraft()}>{savingDraft ? "Saving…" : "Save draft"}</Button>
                  <Button size="sm" aria-describedby="publishing-status" disabled={issues.length > 0} onClick={() => setPublishOpen(true)}>Publish version</Button>
                </div>
              )}
            </header>

            <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 md:px-8 md:py-8">
              {route.page === "library" ? (
                <LibraryPage
                  packs={packs}
                  versions={versions}
                  activeId={active}
                  dirtyPackId={dirty && opened ? opened.packId : null}
                  onImport={() => fileRef.current?.click()}
                  onChanged={() => void refresh()}
                  onMakeDefault={makeDefault}
                />
              ) : workspace ?? (
                <p className="flex items-center gap-2 text-muted-foreground" role="status">
                  <LoaderCircleIcon className="size-4 animate-spin" /> {loading ? "Opening pack" : "Loading"}
                </p>
              )}
            </main>
          </SidebarInset>
        </SidebarProvider>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json,.zip"
        className="sr-only"
        aria-label="Import JSON file"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void onImport(f)
          e.target.value = ""
        }}
      />

      <LeaveDialog
        name={leave?.name ?? null}
        onSave={() => saveDraft()}
        onChoose={(ok) => { leave?.resolve(ok); setLeave(null) }}
      />

      {/* Keyed by file selection: each import starts its review from its own content. */}
      {review && <ImportReview key={review.selection} candidate={review.content} note={review.note} onClose={() => setReview(null)} onApply={async (c) => {
        // An installed pack ID: the admin chooses what happens before anything is saved.
        if (packs.some((p) => p.id === c.pack.id)) {
          setImportChoice({ content: c, name: review.name || c.pack.name })
          return null
        }
        return importAsNew(c)
      }} />}

      {draft && opened && (
        <PublishDialog
          // One pack's dialog never shows another pack's result.
          key={opened.packId}
          open={publishOpen}
          onOpenChange={setPublishOpen}
          content={draft}
          versions={versions}
          defaultVersion={defaultVersion}
          onPublish={publish}
          onMakeDefault={makeDefault}
        />
      )}

      <ConflictDialog
        open={!!conflict && editor.sameInstance(conflict.since)}
        onOpenChange={(o) => !o && setConflict(null)}
        onOpenLatest={() => { setConflict(null); if (opened) void reopen(opened.packId) }}
        onReplace={() => { const over = conflict?.revision ?? null; setConflict(null); void saveDraft(over) }}
      />

      <ImportChoice
        candidate={importChoice?.content ?? null}
        existing={packs.find((p) => p.id === importChoice?.content.pack.id) ?? null}
        onClose={() => setImportChoice(null)}
        onUpdate={importAsUpdate}
        onSeparate={async (c) => {
          const error = await createPack(importChoice?.name || c.pack.name, c).catch((e: Error) => e.message)
          return error && `The import could not be saved as a separate pack: ${error}`
        }}
      />

      <Dialog open={!!importIssues} onOpenChange={(o) => !o && setImportIssues(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Import blocked</DialogTitle>
            <DialogDescription>{importIssues?.message}</DialogDescription>
          </DialogHeader>
          {importIssues && importIssues.issues.length > 0 && (
            <ScrollArea type="auto" viewportClassName="max-h-[55dvh]" viewportProps={{ tabIndex: 0, role: "region", "aria-label": "Issues" }}>
              <IssueList issues={importIssues.issues} content={draft ?? undefined} />
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function openedLabel(opened: Opened, versions: VersionSummary[]) {
  if (opened.source === "new") return "New pack, not saved"
  if (opened.source === "draft") return "Draft"
  const v = versions.find((x) => x.id === opened.versionId)
  return v ? `Published ${v.packVersion}` : "Published"
}
