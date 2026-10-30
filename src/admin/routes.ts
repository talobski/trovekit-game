import { Id } from "@/engine/schema"

/*
 * Admin locations, kept in the URL hash so Back, Forward, refresh and direct
 * links work without a server-side router:
 *
 *   #/library
 *   #/new                          creating a pack (no pack exists yet)
 *   #/packs/<pack id>              the pack's Overview
 *   #/packs/<pack id>/<section>
 */

export const SECTIONS = ["overview", "cards", "resources", "rules", "achievements", "relationships", "versions", "preview", "settings"] as const
export type Section = (typeof SECTIONS)[number]

export const SECTION_LABEL: Record<Section, string> = {
  overview: "Overview",
  cards: "Cards",
  resources: "Resources",
  rules: "Rules",
  achievements: "Achievements",
  relationships: "Relationships",
  versions: "Versions",
  preview: "Preview",
  settings: "Settings",
}

export type Route = { page: "library" } | { page: "new" } | { page: "pack"; packId: string; section: Section }

export const LIBRARY: Route = { page: "library" }
export const NEW_PACK: Route = { page: "new" }
export const packRoute = (packId: string, section: Section = "overview"): Route => ({ page: "pack", packId, section })

/** The route a hash names; null when the hash is empty, so the admin may choose where to start. Anything unrecognised is the library. */
export function parseRoute(hash: string): Route | null {
  const path = hash.replace(/^#/, "").replace(/^\/+|\/+$/g, "")
  if (!path) return null
  if (path === "new") return NEW_PACK
  const parts = path.split("/")
  if (parts[0] !== "packs" || parts.length < 2 || parts.length > 3) return LIBRARY
  let packId: string
  try {
    packId = decodeURIComponent(parts[1])
  } catch {
    return LIBRARY
  }
  if (!Id.safeParse(packId).success) return LIBRARY
  const section = parts[2] ?? "overview"
  return (SECTIONS as readonly string[]).includes(section) ? packRoute(packId, section as Section) : packRoute(packId)
}

export function routeHash(route: Route): string {
  if (route.page === "library") return "#/library"
  if (route.page === "new") return "#/new"
  return route.section === "overview" ? `#/packs/${route.packId}` : `#/packs/${route.packId}/${route.section}`
}

export const sameRoute = (a: Route, b: Route) => routeHash(a) === routeHash(b)

/**
 * What a navigation needs before it can happen. Only opening a different pack
 * replaces the editor, so only that can lose unsaved changes. Moving between a
 * pack's sections, to the library or to the creation page keeps the editor as
 * it is: creating a pack asks only once it would replace the editor.
 */
export function transition(editor: { packId: string; dirty: boolean } | null, target: Route): "stay" | "confirm" | "load" {
  if (target.page !== "pack" || target.packId === editor?.packId) return "stay"
  return editor?.dirty ? "confirm" : "load"
}
