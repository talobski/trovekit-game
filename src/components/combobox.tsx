import { CheckIcon, ChevronsUpDownIcon } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useDesktop } from "@/lib/use-media"
import { cn } from "@/lib/utils"

export interface ComboboxOption {
  value: string
  label: string
}

const normalize = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()

/** Every typed word must appear in the label (or value), ignoring case and accents. Predictable for names. */
function filterByWords(value: string, search: string, keywords?: string[]) {
  const haystack = normalize([value, ...(keywords ?? [])].join(" "))
  return normalize(search)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
    ? 1
    : 0
}

/**
 * The shadcn Combobox pattern: a Button trigger with role="combobox" and a
 * searchable Command list, in a Popover on wider screens and a Drawer on phones.
 * Use it for long or searchable lists; use Select for short ones.
 */
export function Combobox({
  id,
  value,
  onValueChange,
  options,
  title,
  placeholder = "Select",
  searchPlaceholder = "Search",
  emptyText = "No results",
  className,
}: {
  id?: string
  value: string
  onValueChange: (value: string) => void
  options: ComboboxOption[]
  /** Heading for the phone drawer; usually the field label. */
  title: string
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const desktop = useDesktop()
  const selected = options.find((o) => o.value === value)

  const trigger = (
    <Button
      id={id}
      type="button"
      variant="outline"
      role="combobox"
      aria-expanded={open}
      className={cn("w-full justify-between px-3 font-normal", !selected && "text-muted-foreground", className)}
    >
      <span className="truncate">{selected?.label ?? placeholder}</span>
      <ChevronsUpDownIcon className="text-muted-foreground" aria-hidden />
    </Button>
  )

  const list = (
    // The current choice starts highlighted, so arrow keys move from it.
    <Command defaultValue={selected?.value} filter={filterByWords} className={cn(!desktop && "[&_[cmdk-item]]:py-3")}>
      <CommandInput placeholder={searchPlaceholder} />
      {/* cmdk keeps the highlighted option in view; ScrollArea provides the themed scrollbar. */}
      <CommandList className="max-h-none overflow-visible">
        <ScrollArea
          type="auto"
          viewportClassName={desktop ? "max-h-[300px]" : "max-h-[50dvh]"}
          // Options are reached from the search field with arrow keys; the results area is also
          // reachable by Tab so it can be scrolled from the keyboard.
          viewportProps={{ tabIndex: 0, role: "group", "aria-label": "Results" }}
        >
          <CommandEmpty>{emptyText}</CommandEmpty>
          <CommandGroup>
            {options.map((o) => (
              <CommandItem
                key={o.value}
                value={o.value}
                keywords={[o.label]}
                onSelect={() => {
                  onValueChange(o.value)
                  setOpen(false)
                }}
              >
                <CheckIcon className={cn(o.value === value ? "opacity-100" : "opacity-0")} aria-hidden />
                <span className="truncate">{o.label}</span>
                {o.value === value && <span className="sr-only">(selected)</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        </ScrollArea>
      </CommandList>
    </Command>
  )

  if (desktop) {
    return (
      // modal: lets the list scroll when the combobox sits inside a Dialog.
      <Popover open={open} onOpenChange={setOpen} modal>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
          {list}
        </PopoverContent>
      </Popover>
    )
  }
  return (
    // autoFocus: move focus into the drawer's search field (vaul leaves it outside by default).
    <Drawer open={open} onOpenChange={setOpen} autoFocus>
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="pb-2 text-left">
          <DrawerTitle className="type-heading">{title}</DrawerTitle>
          <DrawerDescription className="sr-only">{searchPlaceholder}</DrawerDescription>
        </DrawerHeader>
        <div className="border-t pb-[env(safe-area-inset-bottom)]">{list}</div>
      </DrawerContent>
    </Drawer>
  )
}
