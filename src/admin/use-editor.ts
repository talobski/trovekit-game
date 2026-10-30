import { useCallback, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { canonicalJson } from "@/engine/canonical"
import type { Pack, Rules } from "@/engine/schema"
import type { Issue } from "@/engine/validate"
import { contentIssues } from "@/shared/content"
import { adminApi, type PackHead } from "./api"
import { syncDeckSizes, type Content } from "./model"

/** What the editor opened: a pack's draft, its latest published version, or a new pack not saved yet. */
export interface Opened {
  packId: string
  /** The saved content the editor started from; null for a new pack. */
  content: Content | null
  /** Revision to save over; null for a new pack. */
  revision: string | null
  source: "draft" | "published" | "new"
  versionId: string | null
}

export type SaveResult = { ok: true; revision: string } | { ok: false; issues: Issue[] }

/** The editor as an async operation found it when it started. */
export interface Ticket {
  instance: number
  identity: number
  edits: number
}

/**
 * The working copy of one pack. It lives apart from navigation: moving between
 * a pack's sections or to the library never touches it, and only opening
 * another pack replaces it (after the admin has confirmed unsaved changes).
 *
 * Async work that finishes later must not act on a different editor. Three
 * counters describe the editor: `instance` changes when a pack is opened
 * (even the same pack again), `identity` whenever the content is replaced (a
 * new instance, a loaded version, an import), `edits` on every change the
 * admin makes.
 * - A result that replaces the content applies only if none moved since the
 *   work started (`unchanged`).
 * - One that edits in place, like an uploaded image, needs the same identity
 *   (the update functions are bound to the identity of the render that
 *   created them).
 * - A save or publish acknowledgement updates the saved baseline only for
 *   the instance that started it; later edits stay as unsaved changes.
 */
export function useEditor() {
  const [opened, setOpened] = useState<Opened | null>(null)
  const [draft, setDraft] = useState<Content | null>(null)
  const instance = useRef(0)
  const identity = useRef(0)
  const edits = useRef(0)

  const dirty = !!draft && (!opened?.content || canonicalJson(draft) !== canonicalJson(opened.content))
  const issues = useMemo(() => (draft ? contentIssues(draft) : []), [draft])

  // Async handlers read the editor through this, never through a stale render.
  const current = useRef({ opened, draft, dirty })
  current.current = { opened, draft, dirty }

  const showHead = useCallback((head: PackHead) => {
    instance.current++
    identity.current++
    setDraft(structuredClone(head.content))
    setOpened({ packId: head.content.pack.id, content: structuredClone(head.content), revision: head.revision, source: head.source, versionId: head.versionId })
  }, [])

  /** A pack just created on the server (saved as a draft, with its revision) or a new import not saved anywhere yet. */
  const openNew = useCallback((content: Content, revision: string | null) => {
    instance.current++
    identity.current++
    setDraft(structuredClone(content))
    setOpened({ packId: content.pack.id, content: revision ? structuredClone(content) : null, revision, source: revision ? "draft" : "new", versionId: null })
  }, [])

  const ticket = useCallback((): Ticket => ({ instance: instance.current, identity: identity.current, edits: edits.current }), [])
  const unchanged = useCallback((t: Ticket) => t.instance === instance.current && t.identity === identity.current && t.edits === edits.current, [])
  /** The editor that `t` was taken from is still open (it may have been edited since). */
  const sameInstance = useCallback((t: Ticket) => t.instance === instance.current, [])

  /**
   * Save `snapshot` as the pack's one draft over `revision`. The saved baseline
   * moves to `snapshot` only in the editor instance that started the save
   * (`since`), so a late response never marks a reopened or different pack as
   * saved. Edits made meanwhile remain unsaved changes against the new baseline.
   */
  const persistDraft = useCallback(async (snapshot: Content, revision: string | null, since: Ticket): Promise<SaveResult> => {
    const result = await adminApi.saveDraft(snapshot, revision)
    if (result.ok && since.instance === instance.current)
      setOpened({ packId: snapshot.pack.id, content: snapshot, revision: result.revision, source: "draft", versionId: null })
    return result
  }, [])

  const markPublished = useCallback((snapshot: Content, revision: string, versionId: string, since: Ticket) => {
    if (since.instance === instance.current) setOpened({ packId: snapshot.pack.id, content: snapshot, revision, source: "published", versionId })
  }, [])

  // Bound to this render's identity: a call that arrives after the editor was replaced is dropped.
  const boundTo = identity.current
  const live = () => {
    if (boundTo === identity.current) return true
    toast("A change that finished after you left that pack was not applied.")
    return false
  }
  const updatePack = (fn: (p: Pack) => Pack) => {
    if (!live()) return
    edits.current++
    setDraft((d) => (d ? { ...d, pack: syncDeckSizes(fn(structuredClone(d.pack))) } : d))
  }
  const updateRules = (fn: (r: Rules) => Rules) => {
    if (!live()) return
    edits.current++
    setDraft((d) => (d ? { ...d, rules: fn(structuredClone(d.rules)) } : d))
  }
  /**
   * Replace the working copy (an applied import or a loaded version); the saved base stays, so it shows as unsaved changes.
   * With `since`, only if the editor is exactly as it was then: content built from an older snapshot would undo newer edits.
   */
  const replace = useCallback((content: Content, since?: Ticket) => {
    if (since && !unchanged(since)) return false
    identity.current++
    setDraft(structuredClone(content))
    return true
  }, [unchanged])

  return { opened, draft, dirty, issues, current, ticket, unchanged, sameInstance, showHead, openNew, persistDraft, markPublished, updatePack, updateRules, replace }
}

export type Editor = ReturnType<typeof useEditor>
