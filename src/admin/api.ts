import type { PackHead, PackSummary, VersionSummary } from "@/shared/content"
import type { Issue } from "@/engine/validate"
import type { Content } from "./model"

export type { PackHead, VersionSummary }

/** The pack changed since the editor loaded it (another tab or window). */
export class ConflictError extends Error {
  readonly revision: string | null
  constructor(message: string, revision: string | null) {
    super(message)
    this.revision = revision
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-trovekit-admin": "1", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 409 && data.code === "DRAFT_CONFLICT") throw new ConflictError(data.message, data.revision ?? null)
  if (!res.ok && !(res.status === 422 && data.issues)) throw new Error(data.message ?? `Request failed (${res.status})`)
  return data as T
}

export const adminApi = {
  packs: () => call<PackSummary[]>("/admin-api/packs"),
  /** The pack's draft, or else its latest published version. */
  head: (id: string) => call<PackHead>(`/admin-api/drafts/${id}`),
  createDraft: (name: string, content?: Content) => call<{ ok: true; content: Content; revision: string } | { ok: false; issues: Issue[] }>("/admin-api/drafts", { name, content, create: true }),
  /** `revision` is what the editor loaded; null saves a pack that does not exist yet. */
  saveDraft: (content: Content, revision: string | null) =>
    call<{ ok: true; revision: string } | { ok: false; issues: Issue[] }>("/admin-api/drafts", revision === null ? { content, create: true } : { content, revision }),
  archive: (id: string, archived: boolean) => call("/admin-api/archive", { id, archived }),
  schema: () => call("/admin-api/schema"),
  missingAssets: (content: Content) => call<string[]>("/admin-api/missing-assets", content),
  exportBundle: async (content: Content) => {
    const res = await fetch("/admin-api/bundle-export", { method: "POST", headers: { "x-trovekit-admin": "1", "content-type": "application/json" }, body: JSON.stringify(content) })
    if (!res.ok) throw new Error((await res.json()).message ?? "Bundle export failed")
    return res.blob()
  },
  importBundle: async (file: File): Promise<Content> => {
    if (file.size > 64 * 1024 * 1024) throw new Error("Bundle exceeds 64 MB")
    const res = await fetch("/admin-api/bundle-import", { method: "POST", headers: { "x-trovekit-admin": "1", "content-type": "application/zip" }, body: file })
    const data = await res.json(); if (!res.ok) throw new Error(data.message); return data
  },
  list: () => call<{ active: string | null; activeHash: string | null; versions: VersionSummary[] }>("/admin-api/content"),
  get: (id: string) => call<Content>(`/admin-api/versions/${id}`),
  validate: (content: Content) => call<{ ok: boolean; issues: Issue[] }>("/admin-api/validate", content),
  /** Publishes an immutable version. Never changes the default. */
  publish: (content: Content, note: string, revision: string | null) =>
    call<{ ok: true; version: VersionSummary; draftCleared: boolean } | { ok: false; issues: Issue[] }>("/admin-api/versions", { content, note, revision }),
  /** Make default: the version new rooms use. */
  activate: (id: string) => call<{ ok: true }>("/admin-api/active", { id }),
}
