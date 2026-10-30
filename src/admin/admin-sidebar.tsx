import { useRef } from "react"
import { LibraryIcon, PlusIcon } from "lucide-react"
import type { PackSummary, VersionSummary } from "@/shared/content"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import { NEW_PACK, packRoute, routeHash, SECTION_LABEL, SECTIONS, type Route } from "./routes"

/**
 * Library, then every installed pack. Only the selected pack expands into its
 * workspace sections. On phones the same navigation opens as a sheet.
 */
export function AdminSidebar({ route, packs, versions, activeId, editor }: {
  route: Route | null
  packs: PackSummary[]
  versions: VersionSummary[]
  activeId: string | null
  /** The pack in the editor; `unsaved` is set for an imported pack that is not in the library yet. */
  editor: { packId: string; name: string; dirty: boolean; unsaved: boolean } | null
}) {
  const { isMobile, setOpenMobile } = useSidebar()
  // Closing the phone sheet by following a link moves focus to the new page's heading, not back to the menu button.
  const followedLink = useRef(false)
  const follow = () => {
    if (!isMobile) return
    followedLink.current = true
    setOpenMobile(false)
  }
  const defaultPack = versions.find((v) => v.id === activeId)?.packId ?? null
  const entries = editor?.unsaved ? [...packs, { id: editor.packId, name: editor.name, archived: false, published: null, draft: false }] : packs
  const selected = route?.page === "pack" ? route.packId : null

  return (
    <Sidebar
      label="Admin navigation"
      onMobileCloseAutoFocus={(event) => {
        if (!followedLink.current) return
        followedLink.current = false
        event.preventDefault()
        document.getElementById("page-title")?.focus({ preventScroll: true })
      }}
    >
      <SidebarHeader className="px-4 pt-4 pb-2">
        <span className="type-heading text-base">Trovekit Game Admin</span>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Admin" className="contents">
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={route?.page === "library"}>
                    <a href={routeHash({ page: "library" })} aria-current={route?.page === "library" ? "page" : undefined} onClick={follow}>
                      <LibraryIcon />
                      <span>Library</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>Content packs</SidebarGroupLabel>
            <SidebarGroupAction asChild title="New pack">
              <a href={routeHash(NEW_PACK)} onClick={follow}>
                <PlusIcon />
                <span className="sr-only">New pack</span>
              </a>
            </SidebarGroupAction>
            <SidebarGroupContent>
              <SidebarMenu>
                {entries.length === 0 && <li className="px-2 py-1.5 text-sm text-muted-foreground">No packs yet</li>}
                {entries.map((p) => {
                  const open = selected === p.id
                  const status = editor?.packId === p.id && editor.dirty ? "Unsaved" : p.draft ? "Draft" : p.archived ? "Archived" : null
                  const isDefault = defaultPack === p.id
                  return (
                    <SidebarMenuItem key={p.id}>
                      <SidebarMenuButton asChild className={cn(isDefault && status ? "pr-32" : "pr-20", open && "font-medium text-foreground", p.archived && !open && "text-muted-foreground")}>
                        <a href={routeHash(packRoute(p.id))} onClick={follow}>
                          <span>{p.name}</span>
                        </a>
                      </SidebarMenuButton>
                      <SidebarMenuBadge className="gap-1.5">
                        {isDefault && <span className="font-medium text-success" title="New rooms use this pack">Default</span>}
                        {isDefault && status && <span aria-hidden>·</span>}
                        {status}
                      </SidebarMenuBadge>
                      {open && (
                        <SidebarMenuSub aria-label={`${p.name} sections`}>
                          {SECTIONS.map((section) => {
                            const active = route?.page === "pack" && route.section === section
                            return (
                              <SidebarMenuSubItem key={section}>
                                <SidebarMenuSubButton isActive={active} href={routeHash(packRoute(p.id, section))} aria-current={active ? "page" : undefined} onClick={follow}>
                                  <span>{SECTION_LABEL[section]}</span>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            )
                          })}
                        </SidebarMenuSub>
                      )}
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </SidebarContent>
    </Sidebar>
  )
}
