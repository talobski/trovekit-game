import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { unzipSync } from "fflate"
import { describe, expect, it } from "vitest"
import { exportBundle, importBundle } from "../server/bundles"
import { ContentStore } from "../server/content-store"
import { crc32, localHeader, rawZip, streamedZip } from "./fixtures/raw-zip"
import { starfallBundle } from "./fixtures/starfall"

const dir = () => mkdtempSync(join(tmpdir(), "trovekit-bundle-zip-"))
const asset = (i: number) => `assets/${i.toString(16).padStart(64, "0")}.webp`
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

/** Local entries laid end to end, with their offsets, for a directory to point at. */
function locals(entries: { name: string; data: Uint8Array; size?: number }[]) {
  let offset = 0
  const parts: Buffer[] = []
  const placed = entries.map((e) => {
    const bytes = localHeader(e.name, e.data, crc32(e.data), e.size ?? e.data.length)
    parts.push(bytes)
    const at = offset
    offset += bytes.length
    return { name: e.name, header: at, compressed: e.data.length, size: e.size ?? e.data.length, crc: crc32(e.data) }
  })
  return { bytes: Buffer.concat(parts), placed }
}

describe("complete-pack ZIP imports", () => {
  it("still import and export a valid pack with its images", async () => {
    const { zip, content, images } = await starfallBundle()
    const to = dir()
    expect(await importBundle(to, zip)).toEqual(content)
    // An export of the imported pack imports again unchanged.
    expect(await importBundle(dir(), Buffer.from(exportBundle(to, content)))).toEqual(content)
    expect(images.length).toBeGreaterThan(0)
  })

  it("import an export rewritten by a streaming writer that uses data descriptors", async () => {
    const { zip, content } = await starfallBundle()
    const to = dir()
    await importBundle(to, zip)
    const streamed = streamedZip(unzipSync(exportBundle(to, content)))
    expect(streamed.readUInt16LE(6) & 8).toBe(8)
    expect(await importBundle(dir(), streamed)).toEqual(content)
  })

  it("refuse a local header that contradicts the directory, and save nothing", async () => {
    const to = dir()
    const manifest = json({ bundleVersion: 1, assets: {} }), content = json({})
    const { bytes, placed } = locals([{ name: "manifest.json", data: manifest }, { name: "content.json", data: content }])
    // content.json's local header claims one byte more than the directory and the data.
    bytes.writeUInt32LE(content.length + 1, placed[1].header + 22)
    await expect(importBundle(to, rawZip(bytes, placed))).rejects.toMatchObject({ status: 422, message: "The ZIP entry content.json has a local header that contradicts the directory" })
    expect(new ContentStore(to).list().versions).toHaveLength(0)
  })

  it("refuse directory entries that point many asset names at one payload, before unpacking it", async () => {
    const payload = new Uint8Array(8 * 1024 * 1024 - 1024).fill(5)
    const { bytes, placed } = locals([
      { name: "manifest.json", data: json({ bundleVersion: 1, assets: {} }) },
      { name: "content.json", data: json({}) },
      { name: asset(0), data: payload, size: 9 },
    ])
    const shared = placed[2]
    // Nine asset names, each declaring 9 bytes, all pointing at the same 8 MB of data.
    const central = [placed[0], placed[1], ...Array.from({ length: 9 }, (_, i) => ({ ...shared, name: asset(i) }))]
    const before = process.memoryUsage().arrayBuffers
    await expect(importBundle(dir(), rawZip(bytes, central))).rejects.toMatchObject({ status: 422 })
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(32 * 1024 * 1024)
  })

  it("refuse a stored entry whose sizes disagree, and overlapping entries", async () => {
    const manifest = json({ bundleVersion: 1, assets: {} })
    const content = json({})
    const { bytes, placed } = locals([{ name: "manifest.json", data: manifest }, { name: "content.json", data: content }])
    await expect(importBundle(dir(), rawZip(bytes, [placed[0], { ...placed[1], size: 9 }]))).rejects.toThrow("misstates the size of content.json")
    // content.json's header and data sit inside manifest.json's data.
    const inner = localHeader("content.json", content)
    const outer = localHeader("manifest.json", inner)
    await expect(importBundle(dir(), rawZip(outer, [
      { name: "manifest.json", header: 0, compressed: inner.length, size: inner.length, crc: crc32(inner) },
      { name: "content.json", header: 30 + "manifest.json".length, compressed: content.length, size: content.length, crc: crc32(content) },
    ]))).rejects.toThrow("Entries in the ZIP overlap")
  })

  it("refuse oversized JSON and assets from their sizes, before unpacking them", async () => {
    const big = new Uint8Array(1024 * 1024 + 1)
    const { bytes, placed } = locals([{ name: "manifest.json", data: big }, { name: "content.json", data: json({}) }])
    await expect(importBundle(dir(), rawZip(bytes, placed))).rejects.toThrow("JSON exceeds 1 MB")
    const image = new Uint8Array(8 * 1024 * 1024 + 1)
    const withAsset = locals([{ name: "manifest.json", data: json({ bundleVersion: 1, assets: {} }) }, { name: "content.json", data: json({}) }, { name: asset(1), data: image }])
    await expect(importBundle(dir(), rawZip(withAsset.bytes, withAsset.placed))).rejects.toThrow("ZIP expanded size limit exceeded")
  })

  it("keep unsafe paths and broken archives out, and save nothing", async () => {
    const to = dir()
    const { bytes, placed } = locals([{ name: "../escape.json", data: json({}) }])
    await expect(importBundle(to, rawZip(bytes, placed))).rejects.toThrow("Unsafe or unsupported ZIP path")
    await expect(importBundle(to, Buffer.from("not a zip"))).rejects.toThrow("This is not a ZIP file")
    expect(new ContentStore(to).list().versions).toHaveLength(0)
  })
})
