import { createHash } from "node:crypto"
import { zipSync, strToU8, strFromU8 } from "fflate"
import sharp from "sharp"
import { assetBytes, ASSET_PATH, storeImage } from "./assets.ts"
import { packImages, validateContent, type Content } from "../src/shared/content.ts"
import { HttpError } from "./http.ts"
import { readZip } from "./zip-reader.ts"

export const BUNDLE_LIMIT = 64 * 1024 * 1024
export function exportBundle(dataDir: string, content: Content) {
  const files: Record<string, Uint8Array> = { "content.json": strToU8(JSON.stringify(content)) }
  const assets: Record<string, string> = {}
  for (const image of packImages(content.pack)) {
    const bytes = assetBytes(dataDir, image.src)
    if (!bytes) throw new HttpError(422, "MISSING_ASSET", `Missing local image for ${image.owner}`)
    const name = `assets/${image.src.split("/").pop()}`
    files[name] = bytes; assets[image.src] = name
  }
  files["manifest.json"] = strToU8(JSON.stringify({ bundleVersion: 1, assets }))
  const total = Object.values(files).reduce((n, b) => n + b.length, 0)
  if (total > BUNDLE_LIMIT) throw new HttpError(413, "TOO_LARGE", "Bundle exceeds 64 MB")
  return zipSync(files, { level: 0 })
}
export async function importBundle(dataDir: string, bytes: Buffer): Promise<Content> {
  if (bytes.length > BUNDLE_LIMIT) throw new HttpError(413, "TOO_LARGE", "Bundle exceeds 64 MB")
  let total = 0, count = 0
  try {
    // The strict reader checks the archive's structure first, so these sizes hold when unpacking (server/zip-reader.ts).
    const files = readZip(bytes, { maxEntries: 402, accept(file) {
      if (!/^(manifest\.json|content\.json|assets\/[a-f0-9]{64}\.webp)$/.test(file.name)) throw new Error(`Unsafe or unsupported ZIP path: ${file.name.slice(0, 120)}`)
      if (file.name.endsWith(".json") && file.size > 1024 * 1024) throw new Error("JSON exceeds 1 MB")
      total += file.size
      if (++count > 402 || file.size > 8 * 1024 * 1024 || total > BUNDLE_LIMIT) throw new Error("ZIP expanded size limit exceeded")
      return true
    } })
    if (!files["manifest.json"] || !files["content.json"]) throw new Error("Missing bundle manifest or content")
    const manifest = JSON.parse(strFromU8(files["manifest.json"]))
    if (manifest.bundleVersion !== 1 || !manifest.assets || typeof manifest.assets !== "object" || Array.isArray(manifest.assets)) throw new Error("Unsupported bundle manifest")
    const checked = validateContent(JSON.parse(strFromU8(files["content.json"])))
    if (!checked.ok) throw new Error(checked.issues.map(i => `${i.path}: ${i.message}`).join("\n"))
    const pending: { src: string; bytes: Buffer }[] = []
    for (const { owner, src } of packImages(checked.content.pack)) {
      const match = src.match(ASSET_PATH), name = manifest.assets[src]
      if (!match || name !== `assets/${match[1]}.webp` || !files[name]) throw new Error(`Missing asset for ${owner}`)
      const image = Buffer.from(files[name])
      if (createHash("sha256").update(image).digest("hex") !== match[1]) throw new Error(`Asset hash mismatch for ${owner}`)
      const meta = await sharp(image, { limitInputPixels: 20_000_000 }).metadata()
      if (meta.format !== "webp" || meta.width !== 480 || meta.height !== 600 || (meta.pages ?? 1) !== 1) throw new Error("Bundled images must be prepared 480 × 600 WebP assets")
      await sharp(image).raw().toBuffer() // full decode before accepting
      pending.push({ src, bytes: image })
    }
    // No content/version changes; assets are staged only after the entire bundle validates.
    for (const image of pending) storeImage(dataDir, image)
    return checked.content
  } catch (e) { throw new HttpError(422, "INVALID_BUNDLE", (e as Error).message) }
}
