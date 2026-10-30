import { useRef, type ReactNode } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useDesktop } from "@/lib/use-media"
import { cn } from "@/lib/utils"

/**
 * One interaction, two presentations: bottom drawer on phones, dialog on wider screens.
 *
 * Focus: on open, Radix moves focus to the first focusable element inside.
 * Content-first sheets pass `focusBody`, which makes the scrollable body that
 * element (so it can be read and scrolled by keyboard); other sheets open on
 * their first control. On close, focus returns to the element that opened the
 * sheet, when it still exists.
 */
export function ResponsiveSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  focusBody = false,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  focusBody?: boolean
  className?: string
}) {
  const desktop = useDesktop()
  // Radix returns focus only to its own Trigger, but these sheets open from many
  // places (any card, any row). Remember the opener via Radix's focus hooks.
  const opener = useRef<HTMLElement | null>(null)
  const focusHooks = {
    onOpenAutoFocus: () => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    },
    onCloseAutoFocus: (event: Event) => {
      const el = opener.current
      if (!el?.isConnected) return // gone: leave it to Radix
      event.preventDefault()
      el.focus({ preventScroll: true })
    },
  }
  // The body scrolls inside the sheet; the header and footer stay put.
  const body = (padding: string) => (
    <ScrollArea
      type="auto"
      className="flex min-h-0 flex-1 flex-col"
      viewportClassName={cn("min-h-0 flex-1 pb-4 focus-visible:ring-inset", padding)}
      viewportProps={focusBody ? { tabIndex: 0 } : undefined}
    >
      {children}
    </ScrollArea>
  )
  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={cn("flex max-h-[min(44rem,90dvh)] flex-col gap-0 p-0 sm:max-w-md", className)} {...focusHooks}>
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle className="text-xl">{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
          </DialogHeader>
          {body("px-6")}
          {footer && <div className="flex flex-col gap-2 border-t px-6 py-4">{footer}</div>}
        </DialogContent>
      </Dialog>
    )
  }
  return (
    // autoFocus: vaul otherwise cancels Radix's move of focus into the drawer.
    <Drawer open={open} onOpenChange={onOpenChange} autoFocus>
      <DrawerContent className={cn("max-h-[92dvh]", className)} {...focusHooks}>
        <DrawerHeader className="px-4 pt-3 pb-3 text-left">
          <DrawerTitle className="type-heading text-xl">
            {title}
          </DrawerTitle>
          {description ? <DrawerDescription>{description}</DrawerDescription> : <DrawerDescription className="sr-only">{title}</DrawerDescription>}
        </DrawerHeader>
        {body("px-4")}
        {footer && <div className="flex flex-col gap-2 border-t px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </DrawerContent>
    </Drawer>
  )
}
