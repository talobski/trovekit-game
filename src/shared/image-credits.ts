import { z } from "zod"
import { Id, Text, type Card } from "../engine/schema"

/*
 * Card images in a ZIP, and where each came from. The limits are the ones the
 * image importer enforces (server/assets.ts and server/image-zip.ts); prompts
 * quote them from here so they never drift apart.
 */
export const IMAGE_LIMITS = {
  /** Bytes per image file. */
  fileBytes: 8 * 1024 * 1024,
  /** Images per batch, loose or in one ZIP. */
  files: 400,
  /** Bytes per batch: the ZIP itself, and the images inside it once unpacked. */
  batchBytes: 64 * 1024 * 1024,
  minSide: 64,
  maxSide: 8000,
  pixels: 20_000_000,
} as const

/** An image file named for its card: `<card id>.jpg|.jpeg|.png|.webp`. */
export const IMAGE_FILENAME = /^[a-z0-9][a-z0-9_-]{0,47}\.(jpe?g|png|webp)$/i
/** The card ID an image file is for. */
export const imageCardId = (filename: string) => filename.replace(/\.[^.]+$/, "").toLowerCase()

/** The source list inside an image ZIP. */
export const IMAGE_MANIFEST = "trovekit-images.json"
export const IMAGE_MANIFEST_FORMAT = "trovekit-card-images"

const Https = (what: string) => z.string().trim().url(`Use a full ${what} URL`).max(1000).refine((s) => s.startsWith("https://"), `Use an HTTPS ${what} URL`)

/**
 * One image's source, as an assistant reports it. These are claims: importing
 * them records them, it does not confirm that the image may be used.
 */
export const ImageCredit = z.object({
  cardId: Id,
  file: z.string().max(200).optional(),
  source: Https("source").optional(),
  creator: Text(160).optional(),
  license: Text(160).optional(),
  licenseUrl: Https("license").optional(),
  attribution: Text(1000).optional(),
  modifications: Text(300).optional(),
  restrictions: Text(1000).optional(),
  alt: Text(120).optional(),
})
export type ImageCredit = z.infer<typeof ImageCredit>

const Manifest = z.object({
  format: z.literal(IMAGE_MANIFEST_FORMAT, `Set "format" to "${IMAGE_MANIFEST_FORMAT}"`),
  version: z.literal(1, 'Set "version" to 1'),
  images: z.array(z.unknown()).max(IMAGE_LIMITS.files, `At most ${IMAGE_LIMITS.files} images`),
})

const basename = (path: string) => path.split("/").pop() ?? path

/**
 * Whether source details belong to an image file. Details may leave out
 * `file`, and then match by card ID alone; when they name a file, it must be
 * that very image, so one image's creator and license never land on another.
 */
export function creditMatchesFile(credit: ImageCredit, file: string): boolean {
  return !credit.file || basename(credit.file).toLowerCase() === basename(file).toLowerCase()
}

export interface ManifestResult {
  /** Usable source details by card ID. */
  credits: Record<string, ImageCredit>
  /** Entries that were left out, and why. */
  problems: string[]
}

/** Read a source list. Bad entries are reported and left out; the images still import without them. */
export function readImageManifest(data: unknown): ManifestResult {
  const top = Manifest.safeParse(data)
  if (!top.success) return { credits: {}, problems: [`${IMAGE_MANIFEST}: ${top.error.issues.map((i) => i.message).join("; ")}`] }
  const credits: Record<string, ImageCredit> = {}
  const problems: string[] = []
  top.data.images.forEach((raw, index) => {
    const entry = ImageCredit.safeParse(raw)
    const label = `Source entry ${index + 1}${raw && typeof raw === "object" && "cardId" in raw ? ` (${String((raw as { cardId: unknown }).cardId).slice(0, 48)})` : ""}`
    if (!entry.success) return problems.push(`${label}: ${entry.error.issues.map((i) => `${i.path.join(".") || "entry"}: ${i.message}`).join("; ")}`)
    if (entry.data.file && (!IMAGE_FILENAME.test(basename(entry.data.file)) || imageCardId(basename(entry.data.file)) !== entry.data.cardId)) return problems.push(`${label}: its file ${basename(entry.data.file).slice(0, 60)} is not an image for ${entry.data.cardId}, so these details are left out`)
    if (credits[entry.data.cardId]) return problems.push(`${label}: another entry already describes ${entry.data.cardId}; only the first is used`)
    if (entry.data.attribution && entry.data.modifications && changesNote(entry.data).length > 1000) return problems.push(`${label}: attribution and modifications together are longer than 1000 characters`)
    credits[entry.data.cardId] = entry.data
  })
  return { credits, problems }
}

/**
 * Licenses such as CC BY ask the credit to say whether the image was changed,
 * so modifications are kept with the attribution text rather than in a field
 * of their own.
 */
function changesNote(credit: ImageCredit): string {
  if (!credit.modifications) return credit.attribution ?? ""
  const changes = `Changes: ${credit.modifications}`
  return credit.attribution ? `${credit.attribution} ${changes}` : changes
}

/** Card artwork for a newly imported image: its own source details only, never a previous image's. */
export function artFor(src: string, cardName: string, credit?: ImageCredit): NonNullable<Card["art"]> {
  if (!credit) return { src, alt: cardName }
  const attribution = changesNote(credit) || undefined
  const art: NonNullable<Card["art"]> = {
    src,
    alt: credit.alt ?? cardName,
    source: credit.source,
    creator: credit.creator,
    license: credit.license,
    licenseUrl: credit.licenseUrl,
    attribution,
    restrictions: credit.restrictions,
  }
  for (const key of Object.keys(art) as (keyof typeof art)[]) if (art[key] === undefined) delete art[key]
  return art
}
