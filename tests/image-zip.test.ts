import { existsSync, mkdtempSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { strToU8, zipSync } from "fflate"
import sharp from "sharp"
import { describe, expect, it } from "vitest"
import { readImageZip } from "../server/image-zip"
import { artFor, creditMatchesFile, IMAGE_LIMITS, IMAGE_MANIFEST, IMAGE_MANIFEST_FORMAT, readImageManifest } from "../src/shared/image-credits"
import { Card } from "../src/engine/schema"
import { crc32, dataDescriptor, localHeader, rawZip, streamedZip } from "./fixtures/raw-zip"

const dir = () => mkdtempSync(join(tmpdir(), "trovekit-image-zip-"))
const png = (color = "blue", size = 80) => sharp({ create: { width: size, height: size, channels: 3, background: color } }).png().toBuffer()
const jpeg = () => sharp({ create: { width: 80, height: 80, channels: 3, background: "red" } }).jpeg().toBuffer()
const zip = (files: Record<string, Uint8Array>, level: 0 | 9 = 0) => Buffer.from(zipSync(files, { level }))
const manifest = (images: unknown[]) => strToU8(JSON.stringify({ format: IMAGE_MANIFEST_FORMAT, version: 1, images }))
const credit = { cardId: "aria", source: "https://example.org/aria", creator: "Jane Smith", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", attribution: "Photo by Jane Smith", modifications: "Cropped and resized by Trovekit", alt: "A girl with a lantern" }
const refused = (data: string, bytes: Uint8Array) => expect(readImageZip(data, bytes)).rejects.toMatchObject({ status: 422 })

describe("source lists", () => {
  it("keeps good entries, explains bad ones and keeps only the first entry per card", () => {
    const read = readImageManifest({ format: IMAGE_MANIFEST_FORMAT, version: 1, images: [credit, { cardId: "bram", source: "http://insecure.example" }, { cardId: "Bad Id" }, { ...credit, creator: "Someone else" }, { cardId: "cass", notes: "extra keys are ignored" }] })
    expect(Object.keys(read.credits)).toEqual(["aria", "cass"])
    expect(read.credits.aria.creator).toBe("Jane Smith")
    expect(read.problems).toHaveLength(3)
    expect(read.problems[0]).toContain("Source entry 2 (bram): source: Use an HTTPS source URL")
    expect(read.problems[2]).toContain("only the first is used")
    expect(readImageManifest({ format: "something-else", version: 1, images: [] }).problems[0]).toContain(`Set "format" to "${IMAGE_MANIFEST_FORMAT}"`)
    expect(readImageManifest({ format: IMAGE_MANIFEST_FORMAT, version: 1, images: [{ cardId: "a", creator: "<b>x</b>" }] }).problems[0]).toContain("Markup characters")
  })

  it("maps a credit onto the new image's artwork only, with changes kept in the attribution", () => {
    const art = artFor("/art/managed/" + "a".repeat(64) + ".webp", "Aria", readImageManifest({ format: IMAGE_MANIFEST_FORMAT, version: 1, images: [credit] }).credits.aria)
    expect(art).toEqual({ src: expect.any(String), alt: "A girl with a lantern", source: credit.source, creator: "Jane Smith", license: "CC BY 4.0", licenseUrl: credit.licenseUrl, attribution: "Photo by Jane Smith Changes: Cropped and resized by Trovekit" })
    expect(Card.shape.art.safeParse(art).success).toBe(true)
    // Without source details, nothing from an earlier image survives.
    expect(artFor("/art/managed/" + "b".repeat(64) + ".webp", "Aria")).toEqual({ src: expect.any(String), alt: "Aria" })
    const long = readImageManifest({ format: IMAGE_MANIFEST_FORMAT, version: 1, images: [{ cardId: "a", attribution: "x".repeat(990), modifications: "cropped" }] })
    expect(long.problems[0]).toContain("longer than 1000 characters")
  })
})

describe("image ZIPs", () => {
  it("stores card images from the top level or one folder and returns their source details", async () => {
    const data = dir()
    const result = await readImageZip(data, zip({ "cards/aria.png": await png(), "cards/BRAM.JPG": await jpeg(), [`cards/${IMAGE_MANIFEST}`]: manifest([credit]), "__MACOSX/cards/._aria.png": strToU8("junk"), "cards/.DS_Store": strToU8("junk") }))
    expect(result.manifest).toBe(true)
    expect(result.images.map((i) => [i.cardId, !!i.src, i.error])).toEqual([["aria", true, undefined], ["bram", true, undefined]])
    expect(result.credits.aria.license).toBe("CC BY 4.0")
    expect(result.problems).toEqual([])
    expect(readdirSync(join(data, "assets"))).toHaveLength(2)
  })

  it("reports what it cannot use without refusing the rest", async () => {
    const pngBytes = await png()
    const result = await readImageZip(dir(), zip({
      "aria.png": pngBytes,
      "aria.webp": await sharp(pngBytes).webp().toBuffer(),
      "cass.jpg": pngBytes, // a PNG named .jpg
      "notes.txt": strToU8("hello"),
      "a/b/deep.png": pngBytes,
      [IMAGE_MANIFEST]: strToU8("{ not json"),
    }))
    const byFile = Object.fromEntries(result.images.map((i) => [i.file, i.error ?? "ok"]))
    expect(byFile["aria.png"]).toBe("More than one image for aria")
    expect(byFile["aria.webp"]).toBe("More than one image for aria")
    expect(byFile["cass.jpg"]).toContain("File extension does not match")
    expect(result.problems.join("\n")).toContain("notes.txt: not a card image")
    expect(result.problems.join("\n")).toContain("a/b/deep.png: put images at the top of the ZIP or in one folder")
    expect(result.problems.join("\n")).toContain(`${IMAGE_MANIFEST}: not valid JSON`)
  })

  it("refuses unsafe paths, pack bundles, mixed folders and anything over its limits, before storing anything", async () => {
    const data = dir()
    const pngBytes = await png()
    for (const name of ["../escape.png", "/absolute.png", "folder\\back.png", "c:/drive.png", "a/../b.png"]) await refused(data, zip({ [name]: pngBytes }))
    await expect(readImageZip(data, zip({ "content.json": strToU8("{}"), "manifest.json": strToU8("{}") }))).rejects.toThrow("complete pack file")
    await expect(readImageZip(data, zip({ "one/aria.png": pngBytes, "two/bram.png": pngBytes }))).rejects.toThrow("same folder")
    await expect(readImageZip(data, zip({ [IMAGE_MANIFEST]: manifest([]), [`x/${IMAGE_MANIFEST}`]: manifest([]) }))).rejects.toThrow("more than one")
    const many: Record<string, Uint8Array> = {}
    for (let i = 0; i <= IMAGE_LIMITS.files; i++) many[`c${i}.png`] = strToU8("x")
    await expect(readImageZip(data, zip(many))).rejects.toThrow(`more than ${IMAGE_LIMITS.files} images`)
    // Declared sizes: one large entry is reported, a total over the batch limit is refused.
    const big = new Uint8Array(IMAGE_LIMITS.fileBytes + 1)
    expect((await readImageZip(data, zip({ "huge.png": big }, 9))).images[0]).toMatchObject({ cardId: "huge", error: "Larger than 8 MB" })
    const nearly = new Uint8Array(IMAGE_LIMITS.fileBytes - 1024)
    const heavy: Record<string, Uint8Array> = {}
    for (let i = 0; i < 9; i++) heavy[`h${i}.png`] = nearly
    await expect(readImageZip(data, zip(heavy, 9))).rejects.toThrow("more than 64 MB")
    await expect(readImageZip(data, new Uint8Array(IMAGE_LIMITS.batchBytes + 1))).rejects.toMatchObject({ status: 413 })
    await expect(readImageZip(data, strToU8("not a zip"))).rejects.toThrow("This is not a ZIP file, or it is damaged")
    expect(existsSync(join(data, "assets"))).toBe(false)
  })

  it("refuses a compressed entry that unpacks to more than it declares", async () => {
    // Headers understate the size: unpacking stops at the declared size and the archive is refused.
    const real = new Uint8Array(4 * 1024 * 1024).fill(7)
    const bytes = zip({ "liar.png": real }, 9)
    for (let i = 0; i < bytes.length - 4; i++) {
      const signature = bytes.readUInt32LE(i)
      if (signature === 0x04034b50) bytes.writeUInt32LE(100, i + 22)
      if (signature === 0x02014b50) bytes.writeUInt32LE(100, i + 24)
    }
    await expect(readImageZip(dir(), bytes)).rejects.toMatchObject({ status: 422, message: "The ZIP misstates the size of liar.png" })
  })

})

describe("malformed ZIPs", () => {
  it("accepts a well-formed archive from the minimal writer", async () => {
    const image = await png()
    const local = localHeader("aria.png", image)
    const result = await readImageZip(dir(), rawZip(local, [{ name: "aria.png", header: 0, compressed: image.length, size: image.length, crc: crc32(image) }]))
    expect(result.images).toMatchObject([{ cardId: "aria", src: expect.any(String) }])
  })

  it("refuses a stored entry whose sizes disagree, or that claims less than it holds", async () => {
    const image = await png()
    const local = localHeader("aria.png", image)
    // Stored, but declared as expanding to a different size.
    await expect(readImageZip(dir(), rawZip(local, [{ name: "aria.png", header: 0, compressed: image.length, size: 9, crc: crc32(image) }]))).rejects.toThrow("The ZIP misstates the size of aria.png")
    // Both sizes understated in both headers: the nine bytes read fail the checksum.
    const understated = localHeader("aria.png", image, crc32(image), 9, { compressed: 9 })
    await expect(readImageZip(dir(), rawZip(understated, [{ name: "aria.png", header: 0, compressed: 9, size: 9, crc: crc32(image) }]))).rejects.toThrow("The ZIP entry aria.png is damaged")
  })

  it("refuses entries whose bytes overlap, so one payload cannot be counted many times", async () => {
    // b.png's header and data sit inside a.png's data.
    const inner = localHeader("b.png", new Uint8Array(4096).fill(1))
    const outer = localHeader("a.png", inner)
    const innerAt = 30 + "a.png".length
    const zipBytes = rawZip(outer, [
      { name: "a.png", header: 0, compressed: inner.length, size: inner.length, crc: crc32(inner) },
      { name: "b.png", header: innerAt, compressed: 4096, size: 4096, crc: crc32(new Uint8Array(4096).fill(1)) },
    ])
    await expect(readImageZip(dir(), zipBytes)).rejects.toThrow("Entries in the ZIP overlap")
  })

  it("refuses many directory entries pointing at one 8 MB payload without unpacking it", async () => {
    const payload = new Uint8Array(8 * 1024 * 1024 - 1024).fill(3)
    const local = localHeader("p0.png", payload, crc32(payload), 9)
    const central = Array.from({ length: 9 }, (_, i) => ({ name: `p${i}.png`, header: 0, compressed: payload.length, size: 9, crc: crc32(payload) }))
    const before = process.memoryUsage().arrayBuffers
    await expect(readImageZip(dir(), rawZip(local, central))).rejects.toMatchObject({ status: 422 })
    // Refused from the directory alone: nothing near 9 × 8 MB was allocated.
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(32 * 1024 * 1024)
  })

  it("refuses offsets outside the archive, mismatched local headers and duplicate names", async () => {
    const image = await png()
    const local = localHeader("aria.png", image)
    const entry = { name: "aria.png", header: 0, compressed: image.length, size: image.length, crc: crc32(image) }
    await expect(readImageZip(dir(), rawZip(local, [{ ...entry, compressed: image.length + 10_000, size: image.length + 10_000 }]))).rejects.toThrow("points outside the archive")
    await expect(readImageZip(dir(), rawZip(local, [{ ...entry, header: 5 }]))).rejects.toThrow("is damaged")
    await expect(readImageZip(dir(), rawZip(local, [{ ...entry, name: "bram.png" }]))).rejects.toThrow("is damaged")
    await expect(readImageZip(dir(), rawZip(local, [entry, entry]))).rejects.toThrow("lists aria.png twice")
  })

  it("refuses a local header that contradicts the directory, even when the data matches the directory", async () => {
    const image = await png()
    const crc = crc32(image)
    const entry = { name: "aria.png", header: 0, compressed: image.length, size: image.length, crc }
    const contradictory = [
      localHeader("aria.png", image, (crc ^ 1) >>> 0),
      localHeader("aria.png", image, crc, image.length + 1),
      localHeader("aria.png", image, crc, image.length, { compressed: image.length - 1 }),
      localHeader("aria.png", image, crc, image.length, { flags: 0x800 }),
      // The data-descriptor flag in the local header only, with a descriptor that agrees.
      Buffer.concat([localHeader("aria.png", image, 0, 0, { compressed: 0, flags: 8 }), dataDescriptor(crc, image.length, image.length)]),
    ]
    for (const local of contradictory) {
      await expect(readImageZip(dir(), rawZip(local, [entry]))).rejects.toMatchObject({ status: 422, message: "The ZIP entry aria.png has a local header that contradicts the directory" })
    }
    // The flag in the directory only.
    await expect(readImageZip(dir(), rawZip(localHeader("aria.png", image), [{ ...entry, flags: 8 }]))).rejects.toThrow("has a local header that contradicts the directory")
    // With the flag, deferred values are zero; any other value must still match.
    const wrongDeferred = Buffer.concat([localHeader("aria.png", image, (crc ^ 1) >>> 0, 0, { compressed: 0, flags: 8 }), dataDescriptor(crc, image.length, image.length)])
    await expect(readImageZip(dir(), rawZip(wrongDeferred, [{ ...entry, flags: 8 }]))).rejects.toThrow("has a local header that contradicts the directory")
  })

  it("accepts data descriptors, signed or not, after deferred or repeated local values", async () => {
    const image = await png()
    const crc = crc32(image)
    const entry = { name: "aria.png", header: 0, compressed: image.length, size: image.length, crc, flags: 8 }
    const deferred = localHeader("aria.png", image, 0, 0, { compressed: 0, flags: 8 })
    const repeated = localHeader("aria.png", image, crc, image.length, { flags: 8 })
    for (const local of [
      Buffer.concat([deferred, dataDescriptor(crc, image.length, image.length)]),
      Buffer.concat([deferred, dataDescriptor(crc, image.length, image.length, false)]),
      Buffer.concat([repeated, dataDescriptor(crc, image.length, image.length)]),
    ]) {
      const result = await readImageZip(dir(), rawZip(local, [entry]))
      expect(result.images).toMatchObject([{ cardId: "aria", src: expect.any(String) }])
    }
  })

  it("imports a deflated ZIP from a streaming writer that uses data descriptors", async () => {
    const bytes = streamedZip({ "cards/aria.png": await png(), "cards/bram.jpg": await jpeg(), [`cards/${IMAGE_MANIFEST}`]: manifest([credit]) })
    // The writer really deferred its values: the flag is set and the local CRC and sizes are zero.
    expect(bytes.readUInt16LE(6) & 8).toBe(8)
    expect([bytes.readUInt32LE(14), bytes.readUInt32LE(18), bytes.readUInt32LE(22)]).toEqual([0, 0, 0])
    const result = await readImageZip(dir(), bytes)
    expect(result.images.map((i) => [i.cardId, !!i.src, i.error])).toEqual([["aria", true, undefined], ["bram", true, undefined]])
    expect(result.credits.aria.creator).toBe("Jane Smith")
  })

  it("refuses a missing or contradictory data descriptor", async () => {
    const image = await png()
    const crc = crc32(image)
    const entry = { name: "aria.png", header: 0, compressed: image.length, size: image.length, crc, flags: 8 }
    const deferred = localHeader("aria.png", image, 0, 0, { compressed: 0, flags: 8 })
    for (const descriptor of [
      Buffer.alloc(0),
      dataDescriptor((crc ^ 1) >>> 0, image.length, image.length),
      dataDescriptor(crc, image.length + 1, image.length),
      dataDescriptor(crc, image.length, image.length - 1, false),
    ]) {
      await expect(readImageZip(dir(), rawZip(Buffer.concat([deferred, descriptor]), [entry]))).rejects.toMatchObject({ status: 422, message: "The ZIP entry aria.png has a missing or contradictory data descriptor" })
    }
  })
})

describe("source details belong to their image", () => {
  const entry = (cardId: string, file?: string) => ({ cardId, ...(file ? { file } : {}), creator: `Creator of ${cardId}`, license: "CC BY 4.0" })

  it("keeps details whose file is the card's own image, with or without a folder or a file name", async () => {
    const result = await readImageZip(dir(), zip({ "art/aria.png": await png(), "art/bram.jpg": await jpeg(), "art/cass.png": await png("green"), [`art/${IMAGE_MANIFEST}`]: manifest([entry("aria", "aria.png"), entry("bram", "art/BRAM.JPG"), entry("cass")]) }))
    expect(Object.keys(result.credits).sort()).toEqual(["aria", "bram", "cass"])
    expect(result.problems).toEqual([])
  })

  it("leaves out details that name a file for another card, and never moves them to another image", async () => {
    const result = await readImageZip(dir(), zip({ "aria.png": await png(), "bram.png": await png("red"), [IMAGE_MANIFEST]: manifest([entry("aria", "bram.png"), entry("bram", "aria.png")]) }))
    expect(result.credits).toEqual({})
    expect(result.problems).toEqual([
      "Source entry 1 (aria): its file bram.png is not an image for aria, so these details are left out",
      "Source entry 2 (bram): its file aria.png is not an image for bram, so these details are left out",
    ])
    // The images themselves still import, without details.
    expect(result.images.map((i) => [i.cardId, !!i.src])).toEqual([["aria", true], ["bram", true]])
  })

  it("leaves out details that name another format of the card's image than the one in the ZIP", async () => {
    const result = await readImageZip(dir(), zip({ "aria.png": await png(), [IMAGE_MANIFEST]: manifest([entry("aria", "aria.jpg")]) }))
    expect(result.credits).toEqual({})
    expect(result.problems).toEqual(["The source details for aria name aria.jpg, but its image in the ZIP is aria.png, so they are left out"])
    expect(result.images[0].src).toBeDefined()
  })

  it("matches file names the way images are matched, ignoring folders and case", () => {
    const credit = readImageManifest({ format: IMAGE_MANIFEST_FORMAT, version: 1, images: [entry("aria", "Aria.PNG")] }).credits.aria
    expect(creditMatchesFile(credit, "images/aria.png")).toBe(true)
    expect(creditMatchesFile(credit, "aria.webp")).toBe(false)
    expect(creditMatchesFile(readImageManifest({ format: IMAGE_MANIFEST_FORMAT, version: 1, images: [entry("aria")] }).credits.aria, "aria.webp")).toBe(true)
    expect(readImageManifest({ format: IMAGE_MANIFEST_FORMAT, version: 1, images: [entry("aria", "aria.gif")] }).problems[0]).toContain("is not an image for aria")
  })
})

