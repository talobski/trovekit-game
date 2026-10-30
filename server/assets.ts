import { createHash, randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { IncomingMessage, ServerResponse } from "node:http"
import sharp from "sharp"
import { HttpError } from "./http.ts"
import { IMAGE_LIMITS } from "../src/shared/image-credits.ts"

export const IMAGE_LIMIT = IMAGE_LIMITS.fileBytes
export const ASSET_PATH = /^\/art\/managed\/([a-f0-9]{64})\.webp$/
export async function readBytes(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new HttpError(413, "TOO_LARGE", `Maximum upload is ${limit / 1024 / 1024} MB`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/** Decode every upload and re-encode it; never serve original upload bytes. */
export async function prepareImage(bytes: Buffer, filename: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}\.(jpe?g|png|webp)$/i.test(filename)) throw new HttpError(422, "INVALID_IMAGE", "Use a safe filename ending in .jpg, .png or .webp")
  if (!bytes.length || bytes.length > IMAGE_LIMIT) throw new HttpError(413, "TOO_LARGE", "Images must be at most 8 MB")
  try {
    const input = sharp(bytes, { limitInputPixels: IMAGE_LIMITS.pixels, failOn: "warning" })
    const meta = await input.metadata()
    const extension = filename.split(".").pop()!.toLowerCase().replace("jpg", "jpeg")
    if (!["jpeg", "png", "webp"].includes(meta.format ?? "") || meta.format !== extension) throw new Error("File extension does not match decoded JPEG, PNG or WebP content")
    if (!meta.width || !meta.height || meta.width < IMAGE_LIMITS.minSide || meta.height < IMAGE_LIMITS.minSide || meta.width > IMAGE_LIMITS.maxSide || meta.height > IMAGE_LIMITS.maxSide || (meta.pages ?? 1) > 1) throw new Error("Use a still image, 64–8000 pixels per side, at most 20 megapixels")
    const output = await input.rotate().resize(480, 600, { fit: "cover", position: "attention" }).webp({ quality: 82 }).toBuffer()
    const hash = createHash("sha256").update(output).digest("hex")
    return { bytes: output, src: `/art/managed/${hash}.webp`, width: 480, height: 600 }
  } catch (e) {
    throw new HttpError(422, "INVALID_IMAGE", `Cannot decode image: ${(e as Error).message}`)
  }
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")

/** The stored bytes, or null when missing or not matching their content-hash name. */
function intact(path: string, hash: string): Buffer | null {
  if (!existsSync(path)) return null
  const bytes = readFileSync(path)
  return sha256(bytes) === hash ? bytes : null
}

/**
 * Content-addressed and atomic. Bytes go to a unique temporary file that is then
 * renamed into place, so the final file is either absent or complete. Identical
 * concurrent writes (even from separate processes) both succeed: each renames the
 * same bytes. A file whose bytes do not match its name, such as one cut short by a
 * crash before writes were atomic, is replaced.
 */
export function storeImage(dataDir: string, image: { src: string; bytes: Buffer }) {
  const match = image.src.match(ASSET_PATH)
  if (!match) throw new HttpError(422, "INVALID_IMAGE", "Invalid managed asset path")
  if (sha256(image.bytes) !== match[1]) throw new HttpError(422, "INVALID_IMAGE", "Image bytes do not match their asset name")
  const dir = join(dataDir, "assets")
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${match[1]}.webp`)
  if (intact(path, match[1])) return
  const tmp = join(dir, `.${match[1]}.${randomUUID()}.tmp`)
  try {
    writeFileSync(tmp, image.bytes, { flag: "wx" })
    renameSync(tmp, path)
  } finally {
    rmSync(tmp, { force: true })
  }
}

/** Stored bytes for a managed path (TROVEKIT_DATA/assets only; nothing is bundled); never bytes that fail the hash check. */
export function assetBytes(dataDir: string, src: string): Buffer | null {
  const match = src.match(ASSET_PATH)
  if (!match) return null
  return intact(join(dataDir, "assets", `${match[1]}.webp`), match[1])
}

export function serveAsset(dataDir: string, path: string, res: ServerResponse): boolean {
  if (!path.startsWith("/art/managed/")) return false
  const bytes = assetBytes(dataDir, path)
  res.writeHead(bytes ? 200 : 404, { "content-type": "image/webp", "x-content-type-options": "nosniff", "cache-control": bytes ? "public, max-age=31536000, immutable" : "no-store" })
  res.end(bytes ?? undefined)
  return true
}
