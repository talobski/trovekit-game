import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table"
import { useEffect, useMemo, useRef, useState } from "react"
import { CopyIcon, ImageIcon, UploadIcon } from "lucide-react"
import { toast } from "sonner"
import type { Card, Pack, ResourceArt } from "@/engine/schema"
import { ResourceArtImage } from "@/app/game/resource"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { ResponsiveSheet } from "@/components/responsive-sheet"
import { CardArt } from "@/components/card-art"
import { SelectField, TextField } from "./fields"
import { Textarea } from "@/components/ui/textarea"
import { artFor, creditMatchesFile, IMAGE_FILENAME, IMAGE_LIMITS, IMAGE_MANIFEST, imageCardId, type ImageCredit } from "@/shared/image-credits"
import { imagePrompt, imageTargetCards, type ImageTarget } from "./image-prompt"

export function download(name: string, data: string, type = "application/json") {
  const a = document.createElement("a")
  a.href = URL.createObjectURL(new Blob([data], { type }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
export const cardManifest = (pack: Pack) => pack.cards.map(c => ({ id: c.id, name: c.name, filename: `${c.id}.webp`, art: c.art ?? null }))
export async function uploadImage(file: File): Promise<{ src: string }> {
  if (file.size > 8 * 1024 * 1024) throw new Error("Maximum image size is 8 MB")
  const res = await fetch(`/admin-api/assets?filename=${encodeURIComponent(file.name)}`, { method: "POST", headers: { "x-trovekit-admin": "1", "content-type": "application/octet-stream" }, body: file })
  const data = await res.json()
  if (!res.ok) throw new Error(data.message)
  return { src: data.src }
}
/**
 * A card's image and its source details. An upload applies only to the editor
 * that started it, if no later upload replaced it, and only over the artwork
 * the card had when it started (`onUpload` checks that): closing the card,
 * choosing another image or editing the artwork meanwhile all win over a slow
 * upload.
 */
export function CardImageEditor({ card, onChange, onUpload }: { card: Card; onChange: (art: Card["art"]) => void; onUpload: (art: NonNullable<Card["art"]>, before: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  // Each upload's number; closing the editor or starting another upload outdates it.
  const generation = useRef(0)
  const open = useRef(true)
  useEffect(() => {
    open.current = true
    return () => { open.current = false; generation.current++ }
  }, [])
  return <fieldset className="flex flex-col gap-3"><legend className="mb-2 text-sm font-medium">Image</legend>
    <CardArt card={card} className="w-24" />
    <input ref={input} type="file" className="sr-only" aria-label="Card image file" accept=".jpg,.jpeg,.png,.webp" onChange={async e => {
      const file = e.target.files?.[0]; e.target.value = ""
      if (!file) return
      const mine = ++generation.current
      const before = artKey(card.art)
      setBusy(true)
      try {
        const { src } = await uploadImage(file)
        if (!open.current || mine !== generation.current) return void toast(`The image for ${card.name} finished uploading after you closed the card or chose another image, so it was not applied.`)
        onUpload(artFor(src, card.name), before)
      } catch (err) { if (open.current && mine === generation.current) toast.error((err as Error).message) }
      finally { if (open.current && mine === generation.current) setBusy(false) }
    }} />
    <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Uploading…" : card.art ? "Replace image" : "Upload image"}</Button>{card.art && <Button variant="ghost" onClick={() => onChange(undefined)}>Remove image</Button>}</div>
    <p className="text-xs text-muted-foreground">JPEG, PNG or WebP, up to 8 MB. Use artwork you have permission to use. Stored as a 480 × 600 WebP.</p>
    {card.art && ([ ["alt", "Alternative text"], ["source", "Source URL"], ["creator", "Creator / rights holder"], ["license", "License / permission"], ["licenseUrl", "License URL"], ["attribution", "Attribution"], ["restrictions", "Restrictions"] ] as const).map(([key, label]) => <TextField key={key} id={`image-${key}`} label={label} value={card.art?.[key] ?? ""} onChange={v => onChange({ ...card.art!, [key]: v || undefined })} />)}
  </fieldset>
}
/** One image in an import review: the card it is for, and what applying it would do. */
interface Row {
  file: string
  id: string
  status: string
  /** The artwork it would set: the new image with its own source details. */
  art?: NonNullable<Card["art"]>
  /** The card had artwork when the review started. */
  replace: boolean
  credit?: ImageCredit
}
interface ImageZip { images: { file: string; cardId: string; src?: string; error?: string }[]; credits: Record<string, ImageCredit>; manifest: boolean; problems: string[] }

async function uploadImageZip(file: File): Promise<ImageZip> {
  if (file.size > IMAGE_LIMITS.batchBytes) throw new Error("Image ZIPs must be at most 64 MB")
  const res = await fetch("/admin-api/image-zip", { method: "POST", headers: { "x-trovekit-admin": "1", "content-type": "application/zip" }, body: file })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message ?? `Image ZIP failed (${res.status})`)
  return data as ImageZip
}

/** A card's artwork with its details, for telling whether it changed. */
export const artKey = (art: Card["art"]) => JSON.stringify(art ?? null)

/** Get images with AI, and Import images: loose files, or a ZIP with its source list. */
export function CardImages({ pack, update }: { pack: Pack; update: (fn: (p: Pack) => Pack) => void }) {
  return <>
    <GetImages pack={pack} />
    <ImportImages pack={pack} update={update} />
  </>
}

/**
 * A prompt for the admin's own assistant to find images for some of the
 * pack's cards and return them as a ZIP that Import images reads directly.
 */
function GetImages({ pack }: { pack: Pack }) {
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState("missing")
  const [copied, setCopied] = useState<"copied" | "blocked" | null>(null)
  const cards = useMemo(() => {
    const target: ImageTarget = choice === "missing" ? { kind: "missing" } : choice === "all" ? { kind: "all" } : { kind: "group", group: choice.slice("group:".length) }
    return imageTargetCards(pack, target)
  }, [pack, choice])
  const prompt = useMemo(() => imagePrompt(pack, cards), [pack, cards])
  const count = (t: ImageTarget) => imageTargetCards(pack, t).length
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); setCopied("copied") } catch { setCopied("blocked") }
  }
  return <>
    <Button variant="outline" onClick={() => { setCopied(null); setOpen(true) }}><ImageIcon />Get images with AI</Button>
    <ResponsiveSheet open={open} onOpenChange={setOpen} title="Get images with AI" description="Your AI assistant finds images for your cards, checks where they come from and puts them in a ZIP to import here." className="sm:max-w-2xl" footer={<Button disabled={!cards.length} onClick={() => void copy()}><CopyIcon />Copy AI prompt</Button>}>
      <div className="flex flex-col gap-4 text-sm">
        <SelectField id="image-target" label="Cards to include" value={choice} onChange={(v) => { setChoice(v); setCopied(null) }} options={[
          { value: "missing", label: `Cards without artwork (${count({ kind: "missing" })})` },
          { value: "all", label: `All cards (${count({ kind: "all" })})` },
          ...pack.cardGroups.map((g) => ({ value: `group:${g.id}`, label: `${g.label} (${count({ kind: "group", group: g.id })})` })),
        ]} />
        <p aria-live="polite">{cards.length ? `${cards.length} ${cards.length === 1 ? "card" : "cards"} included. The prompt lists each card's name and ID, which names its image file.` : "No cards to include. Every card already has artwork."}</p>
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-muted-foreground">
          <li>Copy the prompt and paste it into an assistant that can browse the web and create files.</li>
          <li>It finds existing images, records each one's source and license, and gives you a ZIP. Original AI artwork is only made if you ask and approve.</li>
          <li>Choose Import images and select the ZIP. You review every match before your draft changes.</li>
        </ol>
        <p className="text-muted-foreground">Sources and licenses are what your assistant reports. Check them before you publish: an image found online is not automatically free to use.</p>
        <p role="status" className="empty:hidden">{copied === "copied" ? "Prompt copied. Paste it into your AI assistant." : copied === "blocked" ? "Your browser did not allow copying. Select the prompt below and copy it." : ""}</p>
        {copied === "blocked" && <Textarea aria-label="Image prompt" readOnly value={prompt} className="min-h-48 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />}
      </div>
    </ResponsiveSheet>
  </>
}

/**
 * Images named by card ID, chosen as files or as one ZIP. Each is decoded and
 * stored by the server first; the review then shows what would change, and
 * applying it never overwrites artwork that changed while the review was open.
 */
function ImportImages({ pack, update }: { pack: Pack; update: (fn: (p: Pack) => Pack) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [review, setReview] = useState<{ rows: Row[]; notes: string[]; zip: boolean; before: Map<string, string> } | null>(null)
  const [busy, setBusy] = useState(false)
  const [replace, setReplace] = useState(false)
  // The newest pack, for checks made after an upload finishes.
  const latest = useRef(pack)
  latest.current = pack
  const choose = async (files: File[]) => {
    if (!files.length) return
    const zips = files.filter((f) => f.name.toLowerCase().endsWith(".zip"))
    if (zips.length && files.length > 1) return toast.error("Choose one ZIP, or images without a ZIP.")
    if (!zips.length && (files.length > IMAGE_LIMITS.files || files.reduce((s, f) => s + f.size, 0) > IMAGE_LIMITS.batchBytes)) return toast.error("Choose at most 400 images and 64 MB per batch")
    // What each card's artwork was when this import started: applying never overwrites a newer change.
    const before = new Map(pack.cards.map((c) => [c.id, artKey(c.art)]))
    setBusy(true); setReplace(false)
    try {
      const notes: string[] = []
      let rows: Row[]
      if (zips.length) {
        const zip = await uploadImageZip(zips[0])
        const ids = new Set(zip.images.map((i) => i.cardId))
        rows = zip.images.map((image) => {
          const card = pack.cards.find((c) => c.id === image.cardId)
          // The server checks this too; details naming another file never reach this image.
          const named = zip.credits[image.cardId]
          const credit = named && creditMatchesFile(named, image.file) ? named : undefined
          if (named && !credit) notes.push(`The source details for ${image.cardId} name another file, so they are left out.`)
          const row: Row = { file: image.file, id: image.cardId, status: "Matched", replace: !!card?.art, credit }
          if (image.error) row.status = image.error
          else if (!card) row.status = "No card with this ID"
          else { row.art = artFor(image.src!, card.name, credit); row.status = card.art ? "Already has image" : "Matched" }
          return row
        })
        if (!zip.manifest) notes.push(`No ${IMAGE_MANIFEST} in this ZIP, so the images have no source details. Add them to each card before you publish.`)
        for (const id of Object.keys(zip.credits)) if (!ids.has(id)) notes.push(`The source list describes ${id}, but the ZIP has no image for it.`)
        notes.push(...zip.problems)
      } else {
        const ids = files.map((f) => imageCardId(f.name))
        rows = []
        for (const [i, file] of files.entries()) {
          const id = ids[i], card = pack.cards.find((c) => c.id === id)
          const row: Row = { file: file.name, id, status: "Matched", replace: !!card?.art }
          if (!IMAGE_FILENAME.test(file.name)) row.status = "Invalid filename or format"
          else if (ids.filter((x) => x === id).length > 1) row.status = "Duplicate ID"
          else if (!card) row.status = "Unmatched"
          else try { row.art = artFor((await uploadImage(file)).src, card.name); row.status = card.art ? "Already has image" : "Matched" } catch (e) { row.status = (e as Error).message }
          rows.push(row)
        }
      }
      setReview({ rows, notes, zip: zips.length > 0, before })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const rows = review?.rows ?? []
  const chosen = rows.filter((r) => r.art && (!r.replace || replace))
  const apply = () => {
    if (!review) return
    // Cards whose artwork changed since the import started keep that newer artwork.
    const changed = new Set(chosen.filter((r) => artKey(latest.current.cards.find((c) => c.id === r.id)?.art) !== review.before.get(r.id)).map((r) => r.id))
    const next = new Map(chosen.filter((r) => !changed.has(r.id)).map((r) => [r.id, r.art!]))
    update((p) => ({ ...p, cards: p.cards.map((c) => (next.has(c.id) && artKey(c.art) === review.before.get(c.id) ? { ...c, art: next.get(c.id) } : c)) }))
    setReview(null)
    if (changed.size) toast(`Applied ${next.size} ${next.size === 1 ? "image" : "images"}. ${changed.size} ${changed.size === 1 ? "card's artwork" : "cards' artwork"} changed while you were reviewing, so ${changed.size === 1 ? "it was" : "they were"} kept.`)
    else toast(`Applied ${next.size} ${next.size === 1 ? "image" : "images"} to the editor`)
  }
  return <>
    <input ref={input} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.zip" className="sr-only" aria-label="Bulk image files" onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; void choose(files) }} />
    <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}><UploadIcon />{busy ? "Checking images…" : "Import images"}</Button>
    <ResponsiveSheet open={review !== null} onOpenChange={(o) => !o && setReview(null)} title="Review images" description="Files are matched to cards by their exact card ID. Changes apply to the editor; publish a version to use them in new games." className="sm:max-w-2xl" footer={<Button disabled={!chosen.length} onClick={apply}>Apply valid matches</Button>}>
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex items-center gap-2"><Switch id="replace-images" checked={replace} onCheckedChange={setReplace} /><Label htmlFor="replace-images">Replace existing images in this batch</Label></div>
        {review?.zip && <p className="text-muted-foreground">Sources and licenses come from the ZIP's source list as your assistant reported them. Trovekit has not checked them; confirm them before you publish.</p>}
        {review && review.notes.length > 0 && <ul aria-label="Import notes" className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground">{review.notes.map((n, i) => <li key={i} className="break-words">{n}</li>)}</ul>}
        <Table className="table-fixed"><TableHeader><TableRow><TableHead>File / card ID</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{rows.map((r, i) => <TableRow key={i}><TableCell className="whitespace-normal break-all">{r.file}<span className="block text-xs text-muted-foreground">{r.id}</span></TableCell><TableCell className="whitespace-normal">{r.status}{review?.zip && r.art && <span className="block text-xs text-muted-foreground break-words">{creditSummary(r.credit)}</span>}</TableCell></TableRow>)}</TableBody></Table>
      </div>
    </ResponsiveSheet>
  </>
}

/** A short line on where an image came from, saying plainly what is missing. */
function creditSummary(credit?: ImageCredit) {
  if (!credit) return "No source details"
  return [credit.creator, credit.license ?? "No license given", credit.source ? "source linked" : "no source link"].filter(Boolean).join(" · ")
}

/**
 * The pack's optional picture for its resources as a whole: none, or an
 * uploaded image with a description. Like a card image, an upload applies only
 * while this editor is open, if no later upload replaced it, and only over the
 * picture the pack had when it started.
 */
export function ResourceArtEditor({ pack, update }: { pack: Pack; update: (fn: (p: Pack) => Pack) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const art = pack.resourceArt
  const set = (next: ResourceArt | undefined) => update((p) => ({ ...p, resourceArt: next }))
  const latest = useRef(pack)
  latest.current = pack
  // Each upload's number; leaving the page or starting another upload outdates it.
  const generation = useRef(0)
  const open = useRef(true)
  useEffect(() => {
    open.current = true
    return () => { open.current = false; generation.current++ }
  }, [])
  const pictureKey = (picture: ResourceArt | undefined) => JSON.stringify(picture ?? null)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-4">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-md border bg-muted/40">
          {art ? <ResourceArtImage art={art} /> : <span className="text-xs text-muted-foreground">None</span>}
        </span>
        <SelectField
          id="resource-art"
          label="Resource picture"
          value={art ? "image" : "none"}
          className="min-w-0 flex-1"
          options={[{ value: "none", label: "None" }, ...(art ? [{ value: "image", label: "Uploaded image" }] : [])]}
          onChange={(v) => set(v === "none" ? undefined : art)}
        />
      </div>
      <input
        ref={input}
        type="file"
        className="sr-only"
        aria-label="Resource picture file"
        accept=".jpg,.jpeg,.png,.webp"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ""
          if (!file) return
          const mine = ++generation.current
          const before = pictureKey(art)
          setBusy(true)
          try {
            const { src } = await uploadImage(file)
            if (!open.current || mine !== generation.current) return void toast("The resource picture finished uploading after you left the page or chose another image, so it was not applied.")
            if (pictureKey(latest.current.resourceArt) !== before) return void toast("The resource picture finished uploading after the picture changed, so it was not applied.")
            // Keeps the description the picture had, as before; only over the picture the upload started from.
            update((p) => (pictureKey(p.resourceArt) === before ? { ...p, resourceArt: { src, alt: p.resourceArt?.alt } } : p))
          } catch (err) {
            if (open.current && mine === generation.current) toast.error((err as Error).message)
          } finally {
            if (open.current && mine === generation.current) setBusy(false)
          }
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Uploading…" : art ? "Replace image" : "Upload image"}
        </Button>
      </div>
      {art && <TextField id="resource-art-alt" label="Picture description" value={art.alt ?? ""} maxLength={120} onChange={(alt) => set({ ...art, alt: alt || undefined })} />}
      <p className="text-xs text-muted-foreground">Optional. Shown as full-bleed artwork on each option when players collect resources. Without one, the options show icons and labels only.</p>
    </div>
  )
}
