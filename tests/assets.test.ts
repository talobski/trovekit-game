import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"
import { describe, expect, it } from "vitest"
import { prepareImage, storeImage, assetBytes, IMAGE_LIMIT } from "../server/assets"
import { ContentStore } from "../server/content-store"
import { starfallContent } from "./fixtures/starfall"

const png = () => sharp({ create: { width: 100, height: 120, channels: 3, background: "red" } }).png().toBuffer()
it("decodes and optimizes immutable images; replacements retain old assets and versions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trovekit-art-"))
  const a = await prepareImage(await png(), "CARD.PNG")
  storeImage(dir, a)
  const b = await prepareImage(await sharp(await png()).negate().png().toBuffer(), "card.png")
  storeImage(dir, b)
  expect(a.src).not.toBe(b.src)
  expect(assetBytes(dir, a.src)).toEqual(a.bytes)
  expect(assetBytes(dir, b.src)).toEqual(b.bytes)
  const metadata = await sharp(a.bytes).metadata()
  expect([metadata.format, metadata.width, metadata.height]).toEqual(["webp", 480, 600])
  const store = new ContentStore(dir), content = starfallContent()
  content.pack.cards[0].art = { src: a.src, creator: "Tester", license: "Original", attribution: "Test art" }
  const saved = store.publish(content, "With image")
  expect(saved.ok).toBe(true)
  content.pack.cards[0].art = { src: b.src }
  store.publish(content, "Replacement")
  if (saved.ok) expect(store.get(saved.version.id)?.pack.cards[0].art?.src).toBe(a.src)
})
it("rejects unsafe names, mismatched bytes, SVG, small and oversized images", async () => {
  const bytes = await png()
  for (const name of ["../card.png", "a/b.png", "card.svg", "card.jpg", "<card>.png"]) await expect(prepareImage(bytes, name)).rejects.toThrow()
  await expect(prepareImage(Buffer.from("<svg></svg>"), "card.png")).rejects.toThrow()
  await expect(prepareImage(Buffer.alloc(IMAGE_LIMIT + 1), "card.png")).rejects.toThrow()
  await expect(prepareImage(await sharp({ create: { width: 10, height: 10, channels: 3, background: "red" } }).png().toBuffer(), "card.png")).rejects.toThrow()
})

describe("atomic, hash-verified storage", () => {
  const prepared = async (background: string) =>
    prepareImage(await sharp({ create: { width: 90, height: 110, channels: 3, background } }).png().toBuffer(), "card.png")

  it("repairs a truncated file and never serves bytes that fail their hash", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trovekit-art-repair-"))
    const image = await prepared("#336699")
    const file = join(dir, "assets", `${image.src.slice("/art/managed/".length)}`)
    mkdirSync(join(dir, "assets"), { recursive: true })
    writeFileSync(file, image.bytes.subarray(0, 100)) // a write cut short before writes were atomic
    expect(assetBytes(dir, image.src)).toBeNull()
    storeImage(dir, image)
    expect(readFileSync(file)).toEqual(image.bytes)
    expect(assetBytes(dir, image.src)).toEqual(image.bytes)
    expect(readdirSync(join(dir, "assets")).filter((f) => f.endsWith(".tmp"))).toEqual([])
  })

  it("refuses bytes that do not match their content-hash name", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trovekit-art-mismatch-"))
    const a = await prepared("#aa0000")
    const b = await prepared("#00aa00")
    expect(() => storeImage(dir, { src: a.src, bytes: b.bytes })).toThrow(/do not match/)
    expect(assetBytes(dir, a.src)).toBeNull()
  })

  it("separate processes writing the same and different images at once all succeed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "trovekit-art-processes-"))
    const images = await Promise.all(["#111111", "#222222", "#333333"].map(prepared))
    const payload = join(dir, "payload.json")
    writeFileSync(payload, JSON.stringify(images.map((i) => ({ src: i.src, bytes: i.bytes.toString("base64") }))))
    const script = join(import.meta.dirname, "fixtures", "store-images.ts")
    // Six writers race: each stores all three images, so every file is written six times concurrently.
    const runs = Array.from({ length: 6 }, () =>
      new Promise<number>((resolve) => {
        const child = spawn(process.execPath, ["--import", "tsx", script, dir, payload], { stdio: "inherit" })
        child.on("exit", (code) => resolve(code ?? 1))
      })
    )
    expect(await Promise.all(runs)).toEqual([0, 0, 0, 0, 0, 0])
    for (const image of images) expect(assetBytes(dir, image.src)).toEqual(image.bytes)
    expect(readdirSync(join(dir, "assets")).sort()).toEqual(images.map((i) => i.src.slice("/art/managed/".length)).sort())
  }, 60_000)
})
