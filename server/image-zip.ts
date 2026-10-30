import { strFromU8 } from "fflate"
import { creditMatchesFile, IMAGE_FILENAME, IMAGE_LIMITS, IMAGE_MANIFEST, imageCardId, readImageManifest, type ImageCredit } from "../src/shared/image-credits.ts"
import { prepareImage, storeImage } from "./assets.ts"
import { HttpError } from "./http.ts"
import { readZip, ZipError } from "./zip-reader.ts"

/** One image found in the ZIP: stored and ready to apply, or why not. */
export interface ZipImage {
  file: string
  cardId: string
  src?: string
  error?: string
}

export interface ImageZipResult {
  images: ZipImage[]
  /** Source details by card ID, from the ZIP's source list. */
  credits: Record<string, ImageCredit>
  /** Whether the ZIP had a source list. */
  manifest: boolean
  /** Source list entries left out, and files that are not card images. */
  problems: string[]
}

/** A ZIP refused for what it contains, as opposed to one that cannot be read at all. */
class Refused extends Error {}

/** Entries any ZIP tool may add; they are passed over, never unpacked. */
const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|\._|Thumbs\.db$|desktop\.ini$)/i
/** Every entry, including skipped ones: a ZIP of tens of thousands of tiny entries is refused outright. */
const MAX_ENTRIES = IMAGE_LIMITS.files * 2 + 100
const MANIFEST_BYTES = 1024 * 1024

/**
 * Card images in a ZIP: `<card id>.jpg|.png|.webp` at the top level or in one
 * folder, with an optional `trovekit-images.json` source list beside them.
 * The archive's structure is checked first (server/zip-reader.ts), so the
 * sizes seen here are ones unpacking will hold to; paths, counts and sizes are
 * then checked before anything is unpacked. Each image goes through the same
 * decoding as a single upload. Nothing about the pack changes here: the admin matches the result to
 * cards and applies it to the editor after review.
 */
export async function readImageZip(dataDir: string, bytes: Uint8Array): Promise<ImageZipResult> {
  if (bytes.length > IMAGE_LIMITS.batchBytes) throw new HttpError(413, "TOO_LARGE", "Image ZIPs must be at most 64 MB")
  const problems: string[] = []
  const names: string[] = []
  let entries = 0, images = 0, total = 0, manifestName: string | null = null, folder: string | null | undefined
  let files: Record<string, Uint8Array>
  try {
    files = readZip(bytes, {
      maxEntries: MAX_ENTRIES,
      accept(file) {
        if (++entries > MAX_ENTRIES) throw new Refused("The ZIP has too many entries")
        const name = file.name
        if (name.includes("\\") || name.startsWith("/") || /(^|\/)\.\.?(\/|$)/.test(name) || /^[a-z]:/i.test(name) || name.includes("\0")) throw new Refused(`Unsafe path in the ZIP: ${name.slice(0, 120)}`)
        if (name.endsWith("/") || JUNK.test(name)) return false
        const parts = name.split("/")
        if (parts.length > 2) { problems.push(`${name}: put images at the top of the ZIP or in one folder`); return false }
        const dir = parts.length === 2 ? parts[0] : null
        const base = parts[parts.length - 1]
        if (base === "manifest.json" || base === "content.json") throw new Refused("This is a complete pack file, not card images. Import it with Import pack in the Library or a pack's Settings.")
        if (base === IMAGE_MANIFEST) {
          if (manifestName) throw new Refused(`The ZIP has more than one ${IMAGE_MANIFEST}`)
          if (file.size > MANIFEST_BYTES) throw new Refused(`${IMAGE_MANIFEST} must be at most 1 MB`)
          manifestName = name
          return true
        }
        if (!IMAGE_FILENAME.test(base)) { problems.push(`${name}: not a card image (use <card id>.jpg, .png or .webp)`); return false }
        // All images in one place, so a stray copy in another folder is not mistaken for the real one.
        if (folder === undefined) folder = dir
        else if (folder !== dir) throw new Refused("Put all images in the same folder of the ZIP")
        if (++images > IMAGE_LIMITS.files) throw new Refused(`The ZIP has more than ${IMAGE_LIMITS.files} images`)
        if (file.size > IMAGE_LIMITS.fileBytes) { problems.push(`${name}: larger than 8 MB`); names.push(name); return false }
        total += file.size
        if (total > IMAGE_LIMITS.batchBytes) throw new Refused("The images in the ZIP add up to more than 64 MB")
        names.push(name)
        return true
      },
    })
  } catch (e) {
    throw new HttpError(422, "INVALID_IMAGE_ZIP", e instanceof Refused || e instanceof ZipError ? e.message : `This ZIP cannot be read: ${(e as Error).message}`)
  }

  let credits: Record<string, ImageCredit> = {}
  const manifest = manifestName !== null
  if (manifestName) {
    let data: unknown
    try { data = JSON.parse(strFromU8(files[manifestName])) } catch (e) { problems.push(`${IMAGE_MANIFEST}: not valid JSON (${(e as Error).message})`) }
    if (data !== undefined) {
      const read = readImageManifest(data)
      credits = read.credits
      problems.push(...read.problems)
    }
  }

  const ids = names.map((name) => imageCardId(name.split("/").pop()!))
  const result: ZipImage[] = []
  for (const [index, name] of names.entries()) {
    const file = name.split("/").pop()!
    const cardId = ids[index]
    const image: ZipImage = { file: name, cardId }
    if (!files[name]) image.error = "Larger than 8 MB"
    else if (ids.indexOf(cardId) !== index || ids.lastIndexOf(cardId) !== index) image.error = `More than one image for ${cardId}`
    else {
      try {
        const prepared = await prepareImage(Buffer.from(files[name]), file)
        storeImage(dataDir, prepared)
        image.src = prepared.src
      } catch (e) { image.error = (e as Error).message }
    }
    result.push(image)
  }
  // Details that name a file must name this card's image in the ZIP, not another of its formats or a file that is not there.
  for (const [cardId, credit] of Object.entries(credits)) {
    const image = result.find((i) => i.cardId === cardId)
    if (!image || creditMatchesFile(credit, image.file)) continue
    delete credits[cardId]
    problems.push(`The source details for ${cardId} name ${credit.file!.split("/").pop()!.slice(0, 60)}, but its image in the ZIP is ${image.file.split("/").pop()}, so they are left out`)
  }
  return { images: result, credits, manifest, problems }
}
