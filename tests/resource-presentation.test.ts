import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { unzipSync, zipSync } from "fflate"
import sharp from "sharp"
import { describe, expect, it } from "vitest"
import { RESOURCE_ICONS, validatePack, type Pack } from "../src/engine"
import { RESOURCE_ICON_COMPONENTS } from "../src/app/game/resource"
import { blankPack } from "../src/admin/import-model"
import { packImages } from "../src/shared/content"
import { assetBytes, prepareImage, storeImage } from "../server/assets"
import { exportBundle, importBundle } from "../server/bundles"
import { starfallContent } from "./fixtures/starfall"

const issues = (p: unknown) => {
  const v = validatePack(p)
  return v.ok ? [] : v.issues.map((i) => `${i.path}: ${i.message}`)
}

describe("resource icons come from the pack", () => {
  it("every allowed icon has a drawing, and wildcards keep their own", () => {
    expect(Object.keys(RESOURCE_ICON_COMPONENTS).sort()).toEqual([...RESOURCE_ICONS].sort())
    expect(RESOURCE_ICONS).not.toContain("sparkle")
  })

  it("each kind names one icon from the list, distinct from the others", () => {
    const { pack } = starfallContent()
    expect(pack.resourceKinds.map((k) => k.icon)).toEqual(["flame", "droplet", "wind", "mountain", "zap"])
    const repeated = structuredClone(pack)
    repeated.resourceKinds[1].icon = "flame"
    expect(issues(repeated)).toContainEqual('resourceKinds.1.icon: Icon "flame" is already used by another resource kind')
    const unknown = structuredClone(pack) as unknown as { resourceKinds: { icon: string }[] }
    unknown.resourceKinds[0].icon = "basketball"
    expect(issues(unknown).some((i) => i.startsWith("resourceKinds.0.icon"))).toBe(true)
    const missing = structuredClone(pack) as unknown as { resourceKinds: { icon?: string }[] }
    delete missing.resourceKinds[0].icon
    expect(issues(missing).some((i) => i.startsWith("resourceKinds.0.icon"))).toBe(true)
  })

  it("the blank template uses generic shapes", () => {
    expect(blankPack("x", "X").pack.resourceKinds.map((k) => k.icon)).toEqual(["circle", "square", "triangle", "diamond", "hexagon"])
  })
})

describe("per-pack resource picture", () => {
  const withArt = (resourceArt: unknown) => ({ ...starfallContent().pack, resourceArt })
  const managed = `/art/managed/${"a".repeat(64)}.webp`

  it("is optional, and only an uploaded image is accepted", () => {
    expect(validatePack(starfallContent().pack).ok).toBe(true)
    expect(blankPack("blank", "Blank").pack.resourceArt).toBeUndefined()
    expect(validatePack(withArt({ src: managed, alt: "Crest" })).ok).toBe(true)
    for (const bad of [
      { src: "https://example.com/a.webp" },
      { src: "/art/players/a.webp" },
      { src: "javascript:alert(1)" },
      { src: managed, extra: true },
      { kind: "image", src: managed },
      { kind: "symbol", symbol: "figure-with-ball" },
      { kind: "svg", markup: "<svg/>" },
    ]) expect(validatePack(withArt(bad)).ok, JSON.stringify(bad)).toBe(false)
  })

  it("is listed with card art so bundles and missing-asset checks include it", () => {
    expect(packImages(withArt({ src: managed }) as Pack).at(-1)).toEqual({ owner: "resourceArt", src: managed })
  })

  it("travels in a ZIP bundle, and a bundle without its file is refused", async () => {
    const from = mkdtempSync(join(tmpdir(), "trovekit-art-from-"))
    const to = mkdtempSync(join(tmpdir(), "trovekit-art-to-"))
    const image = await prepareImage(await sharp({ create: { width: 100, height: 100, channels: 3, background: "#884400" } }).png().toBuffer(), "crest.png")
    storeImage(from, image)
    const content = { pack: withArt({ src: image.src, alt: "Crest" }) as Pack, rules: starfallContent().rules }
    const zip = exportBundle(from, content)
    expect(await importBundle(to, Buffer.from(zip))).toEqual(content)
    expect(assetBytes(to, image.src)).toEqual(image.bytes)
    const files = unzipSync(zip)
    delete files[`assets/${image.src.slice("/art/managed/".length)}`]
    await expect(importBundle(mkdtempSync(join(tmpdir(), "trovekit-art-bad-")), Buffer.from(zipSync(files)))).rejects.toThrow(/resourceArt/)
  })
})

describe("icon choices", () => {
  it("every allowed icon, including the added ones, has a Lucide component", () => {
    for (const id of ["wheat", "beef", "rectangle-circle", "car", "carrot"]) expect(RESOURCE_ICONS).toContain(id)
    for (const id of RESOURCE_ICONS) expect(RESOURCE_ICON_COMPONENTS[id], id).toBeTruthy()
    expect(RESOURCE_ICONS).not.toContain("sparkle")
  })
})
