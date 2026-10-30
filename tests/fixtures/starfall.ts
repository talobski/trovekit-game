/**
 * "Starfall Academy": a complete, original example pack used to show that the
 * engine, server, admin and client run any theme without code changes. Names,
 * archetypes, relationships, achievements and the generated artwork are all
 * original. The content lives in starfall.json; this module adds artwork and a
 * portable ZIP bundle. It is a test fixture only and is never installed by default.
 */
import { strToU8, zipSync } from "fflate"
import sharp from "sharp"
import type { Card } from "../../src/engine/schema.ts"
import type { Content } from "../../src/shared/content.ts"
import { prepareImage } from "../../server/assets.ts"
import starfall from "./starfall.json" with { type: "json" }

/** The pack and rules without artwork (a fresh copy each call). */
export function starfallContent(): Content {
  return structuredClone(starfall) as unknown as Content
}

const ELEMENT_COLORS: Record<string, [string, string]> = {
  ember: ["#7a2410", "#e0702a"],
  tide: ["#0f2f5c", "#3f86c9"],
  gale: ["#0d4440", "#46a89a"],
  stone: ["#2b2f36", "#7d8794"],
  spark: ["#2c1554", "#8e63d6"],
}

const SHAPES: Record<string, string> = {
  ember: '<path d="M240 140 C300 230 330 280 300 350 C285 390 255 410 240 410 C225 410 195 390 180 350 C150 280 180 230 240 140 Z" />',
  tide: '<path d="M110 300 C160 240 200 360 250 300 C300 240 340 360 390 300 L390 380 C340 440 300 320 250 380 C200 440 160 320 110 380 Z" />',
  gale: '<path d="M120 260 C220 200 320 230 360 280 C300 260 230 260 170 300 C250 290 320 320 340 360 C250 330 180 340 130 380 Z" />',
  stone: '<polygon points="240,150 350,215 350,345 240,410 130,345 130,215" />',
  spark: '<polygon points="270,140 170,300 235,300 200,430 320,250 255,250" />',
}

/** Original generated portrait: element gradient, element emblem and rings that vary per card. */
function artSvg(card: Card, index: number): string {
  const [dark, light] = ELEMENT_COLORS[card.permanentResource]
  const rings = Array.from({ length: 2 + (index % 3) }, (_, r) => `<circle cx="240" cy="280" r="${170 + r * 22}" fill="none" stroke="#ffffff" stroke-opacity="${0.12 + r * 0.04}" stroke-width="3" />`).join("")
  const stars = Array.from({ length: 6 }, (_, s) => {
    const x = 40 + ((index * 53 + s * 71) % 400)
    const y = 40 + ((index * 37 + s * 97) % 140)
    return `<circle cx="${x}" cy="${y}" r="${2 + (s % 3)}" fill="#ffffff" fill-opacity="0.7" />`
  }).join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="600" viewBox="0 0 480 600">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${dark}" /><stop offset="1" stop-color="${light}" /></linearGradient></defs>
    <rect width="480" height="600" fill="url(#g)" />${stars}${rings}
    <g fill="#ffffff" fill-opacity="0.88" transform="rotate(${(index * 17) % 30 - 15} 240 280)">${SHAPES[card.permanentResource]}</g>
    <rect x="0" y="470" width="480" height="130" fill="#000000" fill-opacity="0.18" />
  </svg>`
}

const CREST = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="600" viewBox="0 0 480 600">
  <rect width="480" height="600" fill="#1d1b3a" />
  <circle cx="240" cy="300" r="190" fill="#3b2f7a" />
  <polygon points="240,140 280,250 395,250 302,318 338,430 240,362 142,430 178,318 85,250 200,250" fill="#f3d27a" />
</svg>`

/**
 * The pack with prepared artwork for every card and a crest for its Motes, plus a
 * portable ZIP bundle. `as` installs it under another pack id and name.
 */
export async function starfallBundle(as?: { id: string; name: string }): Promise<{ content: Content; zip: Buffer; images: { src: string; bytes: Buffer }[] }> {
  const content = starfallContent()
  if (as) Object.assign(content.pack, as)
  const images: { src: string; bytes: Buffer }[] = []
  const prepare = async (svg: string, filename: string) => {
    const png = await sharp(Buffer.from(svg)).png().toBuffer()
    const image = await prepareImage(png, filename)
    images.push({ src: image.src, bytes: image.bytes })
    return image.src
  }
  for (const [i, card] of content.pack.cards.entries()) {
    const src = await prepare(artSvg(card, i), `${card.id}.png`)
    card.art = { src, alt: `${card.name}, ${card.permanentResource} student`, creator: "Trovekit example generator", license: "MIT", attribution: "Generated original artwork; no third-party images." }
  }
  content.pack.resourceArt = { src: await prepare(CREST, "crest.png"), alt: "Starfall crest" }
  const files: Record<string, Uint8Array> = { "content.json": strToU8(JSON.stringify(content)) }
  const assets: Record<string, string> = {}
  for (const image of images) {
    const name = `assets/${image.src.slice("/art/managed/".length)}`
    files[name] = image.bytes
    assets[image.src] = name
  }
  files["manifest.json"] = strToU8(JSON.stringify({ bundleVersion: 1, assets }))
  return { content, zip: Buffer.from(zipSync(files, { level: 0 })), images }
}
