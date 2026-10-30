import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { toast } from "sonner"
import { ChevronDownIcon, CopyIcon, PlusIcon, SparklesIcon, UploadIcon } from "lucide-react"
import type { Content } from "@/shared/content"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ResponsiveSheet } from "@/components/responsive-sheet"
import { cardPrompt, sampleCards } from "./card-prompt"
import { importCards, type CardImport } from "./import-model"
import { ImportReview } from "./pack-manager"
import { download } from "./images"
import type { Ticket } from "./use-editor"

/**
 * A batch is built from the editor content when its file is chosen. Applying
 * it replaces the whole working copy, so it must not be applied over edits
 * made after that moment: the ticket from `begin` travels with the review,
 * and `apply` refuses it once the editor has changed.
 */
export interface BatchGuard {
  begin: () => Ticket
  current: (since: Ticket) => boolean
  apply: (content: Content, since: Ticket) => boolean
}

const STALE = "Your pack changed while this file was being prepared, so the batch was not applied and your changes are kept. Import the file again to review it against your latest changes."

/**
 * The Cards toolbar: Add card, Generate cards with AI (a pack-aware prompt for
 * the admin's own assistant), any image actions, and Import cards for the file
 * the assistant returns. Batches are reviewed before they change the draft.
 */
export function CardBatch({ content, guard, onAdd, images }: { content: Content; guard: BatchGuard; onAdd: () => void; images?: ReactNode }) {
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<"copied" | "blocked" | null>(null)
  const [showPrompt, setShowPrompt] = useState(false)
  const [review, setReview] = useState<(CardImport & { since: Ticket }) | null>(null)
  const [error, setError] = useState("")
  const [stale, setStale] = useState(false)
  const prompt = useMemo(() => cardPrompt(content), [content])
  const empty = !content.pack.cards.length
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); setCopied("copied") }
    catch { setCopied("blocked"); setShowPrompt(true) }
  }
  const choose = () => input.current?.click()
  // When copying is refused, the prompt is shown selected, ready to copy by hand.
  const promptRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (copied !== "blocked" || !showPrompt) return
    promptRef.current?.focus()
    promptRef.current?.select()
  }, [copied, showPrompt])
  return <div className="flex flex-col gap-3">
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" disabled={!content.pack.cardGroups.length} onClick={onAdd}><PlusIcon />Add card</Button>
      <Button variant={empty ? "default" : "outline"} onClick={() => { setCopied(null); setOpen(true) }}><SparklesIcon />Generate cards with AI</Button>
      {images}
      <Button variant="ghost" onClick={choose}><UploadIcon />Import cards</Button>
    </div>
    {stale && <Alert><AlertTitle>Import the file again</AlertTitle><AlertDescription>{STALE}</AlertDescription></Alert>}
    {error && <Alert variant="destructive"><AlertTitle>Cards were not imported</AlertTitle><AlertDescription className="whitespace-pre-wrap break-words">{error}{"\n"}Correct the file and import it again. Your draft has not changed.</AlertDescription></Alert>}
    <input ref={input} type="file" accept=".json,.csv" className="sr-only" aria-label="Import cards file" onChange={async e => {
      const file = e.target.files?.[0]; e.target.value = ""; if (!file) return
      setError(""); setStale(false); setOpen(false)
      // `content` is the editor as of this moment; the batch is built against it.
      const since = guard.begin()
      try {
        if (file.size > 1024 * 1024) throw new Error("Maximum card import size is 1 MB.")
        const text = await file.text()
        if (!guard.current(since)) return setStale(true)
        setReview({ ...importCards(text, file.name, content), since })
      } catch (err) { setError((err as Error).message) }
    }} />
    <ResponsiveSheet open={open} onOpenChange={setOpen} title="Generate cards with AI" description="Your AI assistant plans the new cards with you, then writes a file to import here. Trovekit does not call an AI service." className="sm:max-w-2xl" footer={<div className="flex flex-wrap items-center justify-end gap-2"><Button variant="outline" onClick={choose}><UploadIcon />Import cards</Button><Button onClick={() => void copy()}><CopyIcon />Copy AI prompt</Button></div>}>
      <div className="flex flex-col gap-4 text-sm">
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-muted-foreground">
          <li>Copy the prompt and paste it into ChatGPT, Claude or another assistant. It knows this pack's resources, groups, rules and existing cards.</li>
          <li>Answer its questions and approve its plan. It writes the cards only after you approve.</li>
          <li>Save the file it gives you and choose Import cards. You review every card before your draft changes.</li>
        </ol>
        <p role="status" className="empty:hidden">{copied === "copied" ? "Prompt copied. Paste it into your AI assistant." : copied === "blocked" ? "Your browser did not allow copying. Select the prompt below and copy it." : ""}</p>
        <Collapsible open={showPrompt} onOpenChange={setShowPrompt}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group -ml-3">View prompt and example<ChevronDownIcon className="transition-transform group-data-[state=open]:rotate-180" aria-hidden /></Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-4 pt-2">
            <div className="space-y-2"><Label htmlFor="card-ai-prompt">Prompt for your AI assistant</Label><Textarea ref={promptRef} id="card-ai-prompt" value={prompt} readOnly className="min-h-60 font-mono text-xs" onFocus={e => e.target.select()} /></div>
            <div className="space-y-2"><h3 className="font-medium">Example JSON batch</h3><p className="text-muted-foreground">A small format example using your resources and groups. Nothing is added until you import and approve it.</p><pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs" tabIndex={0} aria-label="Example JSON batch">{JSON.stringify(sampleCards(content), null, 2)}</pre><Button variant="outline" size="sm" onClick={() => download(`${content.pack.id}-example-cards.json`, JSON.stringify(sampleCards(content), null, 2))}>Download example</Button></div>
            <p className="text-muted-foreground">Batches can be JSON or CSV, up to 1 MB. Existing images and details are kept when omitted. Recopy the prompt after changing your pack.</p>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </ResponsiveSheet>
    {review && <ImportReview candidate={review.candidate} current={content} note={`${review.added} new cards; ${review.replaced} existing IDs replaced. Review the changes before applying them to your draft.`} onClose={() => setReview(null)} onApply={candidate => {
      if (!guard.apply(candidate, review.since)) return setStale(true)
      toast("Cards applied. Review and save your draft when ready.")
    }} />}
  </div>
}
