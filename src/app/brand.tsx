import { useEffect } from "react"
import type { ResourceIcon } from "@/engine/schema"
import { cn } from "@/lib/utils"
import { RESOURCE_ICON_COMPONENTS } from "./game/resource"

const PLATFORM = "Trovekit Game"

/** Temporary typographic identity; no theme-specific imagery. */
export function Logo({ compact, className }: { compact?: boolean; className?: string }) {
  return (
    <a href="/" className={cn("type-heading inline-flex items-center rounded-md text-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", className)} aria-label={`${PLATFORM} home`}>
      <span className={cn(compact && "hidden sm:inline")}>{PLATFORM}</span>
      {compact && <span className="sm:hidden" aria-hidden>T</span>}
    </a>
  )
}

/**
 * The game's own name and icon, linking home: the default pack's on the home
 * page, a room's pinned pack inside the room. A long title is cut short rather
 * than crowding the controls beside it. Without a title (no game set up yet,
 * or still loading) it is the platform logo.
 */
export function GameTitle({ title, icon, compact, className }: { title?: string; icon?: ResourceIcon | null; compact?: boolean; className?: string }) {
  if (!title) return <Logo compact={compact} className={className} />
  const Icon = icon ? RESOURCE_ICON_COMPONENTS[icon] : null
  return (
    <a href="/" className={cn("type-heading inline-flex min-w-0 items-center gap-2 rounded-md text-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", className)} aria-label={`${title} home`}>
      {Icon && <Icon className="size-5 shrink-0" aria-hidden />}
      <span className="truncate">{title}</span>
    </a>
  )
}

/** The browser tab names the game being played; the platform name until one is known. */
export function useDocumentTitle(title?: string) {
  useEffect(() => {
    document.title = title || PLATFORM
  }, [title])
}
