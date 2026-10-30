import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react"
import { ArrowLeftIcon, ChevronDownIcon } from "lucide-react"
import { toast } from "sonner"
import { Text } from "@/engine/schema"
import { newPackId } from "@/shared/pack-id"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ResponsiveSheet } from "@/components/responsive-sheet"
import { adminApi } from "./api"
import { FormField } from "./fields"
import { download } from "./images"
import { blankPack, fullPackPrompt } from "./import-model"
import { LIBRARY, routeHash } from "./routes"

export interface Creation {
  name: string
  description: string
}

/** The required pack name, or why it cannot be used. */
function checkName(name: string): { ok: true; name: string } | { ok: false; message: string } {
  const check = Text(48).safeParse(name)
  if (check.success) return { ok: true, name: check.data }
  return { ok: false, message: check.error.issues.map((i) => (i.message === "Required" ? "Enter a pack name." : i.message)).join("; ") }
}

/**
 * Creating a pack: name it, copy a prompt for an AI assistant, import what it
 * returns, then review it in the pack's workspace. A draft is saved only when
 * the admin imports a pack or creates an empty one manually, so visiting,
 * typing, copying or leaving this page never leaves a draft behind.
 */
export function CreatePackPage({ value, onChange, packIds, onImport, onCreate }: {
  value: Creation
  onChange: (value: Creation) => void
  /** Pack IDs in the library now, so the prompt asks for an ID that is free. */
  packIds: string[]
  /** Choose a pack file; the admin's existing import review takes it from there. */
  onImport: () => void
  /** Create an empty saved draft. Returns an error message, or null once the pack exists. */
  onCreate: (name: string) => Promise<string | null>
}) {
  const [nameError, setNameError] = useState("")
  const [copy, setCopy] = useState<{ state: "copied" } | { state: "blocked"; prompt: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  const footerRef = useRef<HTMLElement>(null)
  useStickyScrollPadding(headerRef, footerRef)

  const set = (next: Partial<Creation>) => {
    onChange({ ...value, ...next })
    // A prompt copied before the change no longer matches the form.
    setCopy(null)
  }
  /** The pack name, or null after showing why it cannot be used. */
  const requireName = () => {
    const checked = checkName(value.name)
    if (checked.ok) return checked.name
    setNameError(checked.message)
    nameRef.current?.focus()
    return null
  }

  const copyPrompt = async () => {
    const name = requireName()
    if (!name) return
    const prompt = fullPackPrompt({ id: newPackId(name, packIds), name, description: value.description })
    try {
      await navigator.clipboard.writeText(prompt)
      setCopy({ state: "copied" })
    } catch {
      setCopy({ state: "blocked", prompt })
    }
  }

  const createManually = async () => {
    const name = requireName()
    if (!name || creating) return
    setCreating(true)
    try {
      const failure = await onCreate(name)
      if (failure) setNameError(failure)
    } catch (e) {
      setNameError((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header ref={headerRef} className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-4 md:px-6">
          <span className="type-heading text-base">Trovekit Game Admin</span>
          <span aria-hidden className="hidden h-5 w-px bg-border sm:block" />
          <span className="hidden text-sm text-muted-foreground sm:block">Create pack</span>
          <Button variant="ghost" size="sm" className="-mr-2 ml-auto" asChild>
            <a href={routeHash(LIBRARY)}>
              <ArrowLeftIcon aria-hidden />
              Back to Library
            </a>
          </Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 pt-8 pb-12 md:pt-14">
        <div className="flex flex-col gap-2">
          <h1 id="page-title" tabIndex={-1} className="text-2xl font-semibold outline-none md:text-3xl">Create your content pack</h1>
          <p className="max-w-prose text-muted-foreground">
            Your AI assistant can write the whole pack for you: resources, cards, rules and achievements. Trovekit checks what it made before you use it.
          </p>
        </div>

        <div className="flex flex-col gap-6">
          <FormField id="create-pack-name" label="Pack name" error={nameError}>
            <Input
              ref={nameRef}
              id="create-pack-name"
              required
              maxLength={48}
              autoComplete="off"
              placeholder="e.g. Mythic Realms"
              value={value.name}
              aria-describedby={nameError ? "create-pack-name-feedback" : undefined}
              aria-invalid={!!nameError}
              onChange={(e) => { set({ name: e.target.value }); setNameError("") }}
            />
          </FormField>
          <FormField id="create-pack-description" label="Describe your game (optional)" hint="Example: A fantasy strategy card game about collecting mythical creatures and ancient artifacts.">
            <Textarea
              id="create-pack-description"
              maxLength={2000}
              className="min-h-24"
              placeholder="The theme, setting, characters or style you have in mind."
              value={value.description}
              aria-describedby="create-pack-description-feedback"
              onChange={(e) => set({ description: e.target.value })}
            />
          </FormField>
        </div>

        <ol className="flex flex-col gap-8" aria-label="Create with an AI assistant">
          <Step number={1} title="Generate">
            <p>Copy a prompt written for this pack and paste it into ChatGPT, Claude or another AI assistant. It asks about your game, suggests a design for you to approve, then writes the pack.</p>
            <div className="flex flex-col gap-2">
              <div><Button onClick={() => void copyPrompt()}>Copy AI prompt</Button></div>
              <p role="status" className="text-sm text-muted-foreground empty:hidden">
                {copy?.state === "copied" && "Prompt copied. Paste it into your AI assistant."}
              </p>
              {copy?.state === "blocked" && <BlockedCopy prompt={copy.prompt} />}
            </div>
          </Step>
          <Step number={2} title="Import">
            <p>Save your assistant's reply as a .json file, then import it. You can also import a pack file you already have, including a ZIP with images. After a quick review, importing saves the pack as a private draft.</p>
            <div><Button variant="outline" onClick={onImport}>Import pack file</Button></div>
          </Step>
          <Step number={3} title="Review">
            <p>The pack opens in its workspace. Review the cards, adjust resources and rules, edit achievements and preview it. When it is ready, publish a version, then make that version the default so new game rooms use it.</p>
          </Step>
        </ol>

        <AdvancedTools />
      </main>

      {/* Stays in view while the page scrolls; it keeps its place in the flow, so the end of the page scrolls clear of it. */}
      <footer ref={footerRef} className="sticky bottom-0 z-20 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-4">
          <p className="text-sm text-muted-foreground">Prefer to build it yourself? Start from an empty pack.</p>
          <Button variant="ghost" className="-mx-3" disabled={creating} onClick={() => void createManually()}>
            {creating ? "Creating…" : "Create manually instead"}
          </Button>
        </div>
      </footer>
    </div>
  )
}

/**
 * Keyboard focus and in-page scrolling stop clear of the sticky header and
 * footer, so a focused field is never hidden behind them. Their heights change
 * when the footer wraps on narrow screens.
 */
function useStickyScrollPadding(header: RefObject<HTMLElement | null>, footer: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = document.documentElement
    const update = () => {
      root.style.scrollPaddingTop = `${header.current?.offsetHeight ?? 0}px`
      root.style.scrollPaddingBottom = `${footer.current?.offsetHeight ?? 0}px`
    }
    update()
    const observer = new ResizeObserver(update)
    for (const el of [header.current, footer.current]) if (el) observer.observe(el)
    return () => {
      observer.disconnect()
      root.style.scrollPaddingTop = ""
      root.style.scrollPaddingBottom = ""
    }
  }, [header, footer])
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4">
      <span aria-hidden className="flex size-7 items-center justify-center rounded-full border text-sm font-medium text-muted-foreground">{number}</span>
      <div className="flex flex-col gap-3 pt-0.5 text-sm text-muted-foreground [&>p]:max-w-prose">
        <h2 className="text-base font-semibold text-foreground">
          <span className="sr-only">Step {number}: </span>{title}
        </h2>
        {children}
      </div>
    </li>
  )
}

/** The browser refused the clipboard: show the prompt to copy by hand. */
function BlockedCopy({ prompt }: { prompt: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-destructive">Your browser did not allow copying. Select the prompt below and copy it.</p>
      <Textarea aria-label="AI prompt" readOnly className="min-h-40 font-mono text-xs" value={prompt} onFocus={(e) => e.currentTarget.select()} />
    </div>
  )
}

/** Pack file utilities for people who prepare packs by hand or with their own tools. */
function AdvancedTools() {
  const [guide, setGuide] = useState(false)
  const downloadSchema = async () => {
    try {
      download("trovekit-content-schema.json", JSON.stringify(await adminApi.schema(), null, 2))
    } catch (e) {
      toast.error(`The schema could not be downloaded: ${(e as Error).message}`)
    }
  }
  return (
    <Collapsible className="text-sm">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="group -ml-3">
          Advanced tools
          <ChevronDownIcon className="transition-transform group-data-[state=open]:rotate-180" aria-hidden />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-4 pt-2">
        <p className="text-muted-foreground">For creating or editing pack files directly.</p>
        <ul aria-label="Advanced tools" className="flex flex-col divide-y border-y">
          <Tool title="Schema reference" description="Understand the structure and validation rules of a Trovekit content pack.">
            <Button variant="outline" size="sm" onClick={() => void downloadSchema()}>Download schema</Button>
          </Tool>
          <Tool title="Blank pack template" description="Start with a ready-made JSON structure you can customize yourself.">
            <Button variant="outline" size="sm" onClick={() => download("blank-pack.json", JSON.stringify(blankPack("my-pack", "My pack"), null, 2))}>Download template</Button>
          </Tool>
          <Tool title="Import format guide" description="Learn how to prepare JSON files and ZIP archives containing card artwork.">
            <Button variant="outline" size="sm" onClick={() => setGuide(true)}>View guide</Button>
          </Tool>
        </ul>
      </CollapsibleContent>
      <ImportGuide open={guide} onOpenChange={setGuide} />
    </Collapsible>
  )
}

function Tool({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </li>
  )
}

/** How pack files are put together, for people who write or edit them without the prompt. */
function ImportGuide({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const code = "rounded bg-muted px-1 py-0.5 font-mono text-xs"
  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} title="Import format guide" description="What Trovekit accepts in Import pack file." focusBody className="sm:max-w-2xl">
      <div className="flex flex-col gap-6 text-sm [&_h3]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_section]:flex [&_section]:flex-col [&_section]:gap-2 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
        <section aria-labelledby="guide-json">
          <h3 id="guide-json">JSON pack files</h3>
          <ul>
            <li>One JSON object with <code className={code}>pack</code> and <code className={code}>rules</code>, each with <code className={code}>"schemaVersion": 2</code>. Files from schema version 1 are not accepted.</li>
            <li>Start from the blank pack template. The schema lists every field, its limits and the allowed icons. Fields that are not in the schema are rejected.</li>
            <li>IDs use 1 to 48 lowercase letters, digits, hyphens or underscores, starting with a letter or digit. Keep an ID once it is used: cards, achievements and relationships refer to each other by ID.</li>
            <li>Up to 1 MB of plain JSON, without Markdown fences or comments. Remote image URLs, SVG, base64 images, scripts and HTML are rejected.</li>
          </ul>
        </section>
        <section aria-labelledby="guide-zip">
          <h3 id="guide-zip">ZIP archives with card artwork</h3>
          <ul>
            <li>A pack with its images travels as a ZIP. Make one with <span className="font-medium">Export with images</span> in a pack's Settings.</li>
            <li>The ZIP holds <code className={code}>content.json</code> (the pack and rules), <code className={code}>manifest.json</code> and the images in <code className={code}>assets/</code>, up to 64 MB.</li>
            <li>Images must be the 480 × 600 WebP files Trovekit prepares when you upload artwork. To add new artwork, upload it in the pack's workspace after importing.</li>
            <li>A JSON file without images also works: cards without artwork show their initials.</li>
          </ul>
        </section>
        <section aria-labelledby="guide-review">
          <h3 id="guide-review">When you import</h3>
          <ul>
            <li>Every import opens a review first, with any problems to fix and the JSON to correct.</li>
            <li>If the pack ID is already in your library, you choose between updating that pack and creating a separate one.</li>
            <li>Importing saves the pack as a private draft. Publishing creates a version of it; making that version the default lets new game rooms use it.</li>
          </ul>
        </section>
        <section aria-labelledby="guide-cards">
          <h3 id="guide-cards">Adding cards in batches</h3>
          <ul>
            <li>A pack's Cards page imports a JSON array of cards, or CSV with the columns <code className={code}>id</code>, <code className={code}>group</code>, <code className={code}>name</code>, <code className={code}>shortName</code>, <code className={code}>permanentResource</code>, <code className={code}>points</code> and <code className={code}>cost.&lt;resource id&gt;</code> for each resource.</li>
            <li>Existing IDs update cards and keep their images when none is given. New IDs add cards.</li>
          </ul>
        </section>
      </div>
    </ResponsiveSheet>
  )
}
