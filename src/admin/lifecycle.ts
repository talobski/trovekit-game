import type { Content, PackSummary, VersionSummary } from "@/shared/content"

/*
 * How the admin describes a pack's lifecycle. A pack can have, independently:
 * an unpublished draft, a latest published version, and the library's single
 * default version (the one new rooms use). See docs/CONTENT_PACKS.md.
 */

export interface PackStatus {
  pack: PackSummary
  /** Newest first. */
  versions: VersionSummary[]
  latest: VersionSummary | null
  /** Set when the library's default version belongs to this pack. */
  defaultVersion: VersionSummary | null
}

export function packStatuses(packs: PackSummary[], versions: VersionSummary[], activeId: string | null): PackStatus[] {
  return packs.map((pack) => {
    const own = versions.filter((v) => v.packId === pack.id)
    const latest = own.find((v) => v.id === pack.published) ?? own[0] ?? null
    return { pack, versions: own, latest, defaultVersion: own.find((v) => v.id === activeId) ?? null }
  })
}

/** What new rooms use, library-wide. Distinguishes "nothing published" from "published, but no default". */
export type DefaultState =
  | { kind: "empty" }
  | { kind: "unpublished" }
  | { kind: "no-default" }
  | { kind: "default"; version: VersionSummary }

export function defaultState(packs: PackSummary[], versions: VersionSummary[], activeId: string | null): DefaultState {
  const version = versions.find((v) => v.id === activeId)
  if (version) return { kind: "default", version }
  if (!packs.length) return { kind: "empty" }
  return versions.length ? { kind: "no-default" } : { kind: "unpublished" }
}

/** A published version of this pack that already uses the editor's version number. */
export function duplicateVersion(versions: VersionSummary[], content: Content): VersionSummary | null {
  return versions.find((v) => v.packId === content.pack.id && v.packVersion === content.pack.version) ?? null
}

export function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}
