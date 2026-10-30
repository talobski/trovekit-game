import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { request } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { strToU8, zipSync } from "fflate"
import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createAdminServer } from "../server/admin-server"
import { createGameServer } from "../server/game-server"
import type { Content, PackHead } from "../src/shared/content"
import { fixtureDataDir } from "./fixtures"
import { starfallContent } from "./fixtures/starfall"

/*
 * HTTP-level coverage for the content routes: the private
 * admin's image, bundle and pack-library routes, and the game server's pack list,
 * pack selection and asset serving. Both servers share one temporary data dir.
 */

const ADMIN = { "x-trovekit-admin": "1" }
let dataDir: string
let admin: string
let adminPort: number
let game: string
const closers: (() => void)[] = []

async function freePort() {
  const probe = createGameServer({ dataDir: mkdtempSync(join(tmpdir(), "trovekit-probe-")) })
  await new Promise<void>((r) => probe.server.listen(0, "127.0.0.1", r))
  const port = (probe.server.address() as AddressInfo).port
  await new Promise<void>((r) => probe.server.close(() => r()))
  return port
}

beforeEach(async () => {
  dataDir = fixtureDataDir("trovekit-http-")
  adminPort = await freePort()
  const a = createAdminServer({ dataDir, port: adminPort })
  await new Promise<void>((r) => a.listen(r))
  admin = `http://127.0.0.1:${adminPort}`
  const g = createGameServer({ dataDir, botDelayMs: 60_000, limits: { roomCreatesPerMinute: 100 } })
  await new Promise<void>((r) => g.server.listen(0, "127.0.0.1", r))
  game = `http://127.0.0.1:${(g.server.address() as AddressInfo).port}`
  closers.push(() => a.server.close(), () => (g.server.closeAllConnections(), g.server.close()))
})
afterEach(() => {
  while (closers.length) closers.pop()!()
})

const png = (w = 120, h = 150, background = "#555555") => sharp({ create: { width: w, height: h, channels: 3, background } }).png().toBuffer()
const json = (body: unknown) => ({ method: "POST", headers: { ...ADMIN, "content-type": "application/json" }, body: JSON.stringify(body) })
const upload = (bytes: Uint8Array, filename: string | null, headers: Record<string, string> = ADMIN) =>
  fetch(`${admin}/admin-api/assets${filename === null ? "" : `?filename=${encodeURIComponent(filename)}`}`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/octet-stream" },
    body: new Blob([new Uint8Array(bytes)]),
  })
const storedAssets = () => {
  try {
    return readdirSync(join(dataDir, "assets"))
  } catch {
    return []
  }
}
const content = (): Content => starfallContent()

/** Raw request so the Host header can be forged (fetch cannot set it). */
function rawStatus(port: number, method: string, path: string, headers: Record<string, string>) {
  return new Promise<number>((resolve) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      res.resume()
      resolve(res.statusCode!)
    })
    req.end(method === "POST" ? "{}" : undefined)
  })
}

const NEW_ADMIN_ROUTES: [string, string][] = [
  ["GET", "/admin-api/packs"],
  ["GET", "/admin-api/schema"],
  ["GET", "/admin-api/drafts/starfall"],
  ["POST", "/admin-api/drafts"],
  ["POST", "/admin-api/archive"],
  ["POST", "/admin-api/missing-assets"],
  ["POST", "/admin-api/bundle-export"],
  ["POST", "/admin-api/bundle-import"],
  ["POST", "/admin-api/assets?filename=card.png"],
]

describe("admin access restrictions", () => {
  it.each(NEW_ADMIN_ROUTES)("%s %s needs the admin header", async (method, path) => {
    const res = await fetch(admin + path, { method, headers: { "content-type": "application/json" }, body: method === "POST" ? "{}" : undefined })
    expect(res.status).toBe(403)
  })

  it.each(NEW_ADMIN_ROUTES)("%s %s refuses a foreign Host (DNS rebinding)", async (method, path) => {
    expect(await rawStatus(adminPort, method, path, { ...ADMIN, host: `evil.example:${adminPort}`, "content-type": "application/json" })).toBe(403)
  })

  it.each(NEW_ADMIN_ROUTES)("the game server does not serve %s %s", async (method, path) => {
    const res = await fetch(game + path, { method, headers: { ...ADMIN, "content-type": "application/json" }, body: method === "POST" ? "{}" : undefined })
    expect(res.status).toBe(404)
  })
})

describe("POST /admin-api/assets", () => {
  it("decodes, stores and serves an image from both servers", async () => {
    const res = await upload(await png(), "aria-ashgrove.png")
    expect(res.status).toBe(201)
    const { src, width, height } = await res.json()
    expect(src).toMatch(/^\/art\/managed\/[a-f0-9]{64}\.webp$/)
    expect([width, height]).toEqual([480, 600])
    for (const base of [admin, game]) {
      const served = await fetch(base + src)
      expect(served.status).toBe(200)
      expect(served.headers.get("content-type")).toBe("image/webp")
      expect(served.headers.get("x-content-type-options")).toBe("nosniff")
      expect(served.headers.get("cache-control")).toContain("immutable")
      const meta = await sharp(Buffer.from(await served.arrayBuffer())).metadata()
      expect([meta.format, meta.width, meta.height]).toEqual(["webp", 480, 600])
    }
  })

  it.each([
    ["not an image", () => Promise.resolve(Buffer.from("hello, this is text")), "card.png", 422],
    ["SVG content named .png", () => Promise.resolve(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), "card.png", 422],
    ["PNG bytes named .jpg", () => png(), "card.jpg", 422],
    ["too small", () => png(20, 20), "card.png", 422],
    ["path traversal in the name", () => png(), "../../escape.png", 422],
    ["a nested name", () => png(), "dir/card.png", 422],
    ["an .svg name", () => png(), "card.svg", 422],
    ["no name", () => png(), null, 422],
    ["empty body", () => Promise.resolve(Buffer.alloc(0)), "card.png", 413],
  ] as const)("rejects %s without storing anything", async (_label, bytes, filename, status) => {
    const res = await upload(await bytes(), filename)
    expect(res.status).toBe(status)
    expect(await res.json()).toMatchObject({ code: status === 413 ? "TOO_LARGE" : "INVALID_IMAGE" })
    expect(storedAssets()).toEqual([])
  })

  it("rejects bodies over 8 MB with 413", async () => {
    const res = await upload(Buffer.alloc(8 * 1024 * 1024 + 1), "card.png")
    expect(res.status).toBe(413)
    expect(storedAssets()).toEqual([])
  })

  it("handles concurrent uploads of the same and different images", async () => {
    const same = await png(200, 250, "#123456")
    const distinct = await Promise.all(["#aa0000", "#00aa00", "#0000aa", "#aaaa00", "#00aaaa", "#aa00aa"].map((c) => png(200, 250, c)))
    const responses = await Promise.all([...Array.from({ length: 12 }, () => upload(same, "same.png")), ...distinct.map((b, i) => upload(b, `card-${i}.png`))])
    expect(responses.map((r) => r.status)).toEqual(Array(18).fill(201))
    const srcs = await Promise.all(responses.map(async (r) => (await r.json()).src as string))
    expect(new Set(srcs.slice(0, 12)).size).toBe(1)
    expect(new Set(srcs).size).toBe(7)
    const files = storedAssets()
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([])
    expect(files.sort()).toEqual([...new Set(srcs)].map((s) => s.slice("/art/managed/".length)).sort())
    for (const src of new Set(srcs)) expect((await fetch(game + src)).status).toBe(200)
  })
})

describe("asset serving", () => {
  it("rejects unknown, corrupt and traversal paths", async () => {
    const { src } = await (await upload(await png(), "card.png")).json()
    expect((await fetch(`${game}/art/managed/${"0".repeat(64)}.webp`)).status).toBe(404)
    // A corrupt file (bytes not matching the name) is never served.
    const corrupt = "f".repeat(64)
    mkdirSync(join(dataDir, "assets"), { recursive: true })
    writeFileSync(join(dataDir, "assets", `${corrupt}.webp`), "truncated")
    expect((await fetch(`${game}/art/managed/${corrupt}.webp`)).status).toBe(404)
    for (const path of ["/art/managed/../../package.json", "/art/managed/%2e%2e%2fpackage.json", "/art/managed/..%2f..%2fpackage.json", `${src.slice(0, -5)}.png`]) {
      expect(await rawStatus(Number(new URL(game).port), "GET", path, {}), path).toBe(path.endsWith(".png") ? 404 : 400)
    }
  })
})

describe("bundle export and import", () => {
  it("round-trips content and images", async () => {
    const { src } = await (await upload(await png(), "card.png")).json()
    const c = content()
    c.pack.cards[0].art = { src, alt: c.pack.cards[0].name, license: "Test", creator: "Tester", attribution: "Test image" }
    const exported = await fetch(`${admin}/admin-api/bundle-export`, json(c))
    expect(exported.status).toBe(200)
    expect(exported.headers.get("content-type")).toBe("application/zip")
    const zip = Buffer.from(await exported.arrayBuffer())
    const imported = await fetch(`${admin}/admin-api/bundle-import`, { method: "POST", headers: { ...ADMIN, "content-type": "application/zip" }, body: zip })
    expect(imported.status).toBe(200)
    expect(await imported.json()).toEqual(c)
  })

  it("rejects invalid content and missing images on export", async () => {
    const bad = content()
    bad.pack.relationships[0].cardIds[0] = "ghost"
    const invalid = await fetch(`${admin}/admin-api/bundle-export`, json(bad))
    expect(invalid.status).toBe(422)
    expect((await invalid.json()).issues[0]).toMatchObject({ path: "pack.relationships.0.cardIds.0" })
    const missing = content()
    missing.pack.cards[0].art = { src: `/art/managed/${"b".repeat(64)}.webp` }
    const res = await fetch(`${admin}/admin-api/bundle-export`, json(missing))
    expect(res.status).toBe(422)
    expect((await res.json()).code).toBe("MISSING_ASSET")
  })

  it.each([
    ["garbage bytes", () => Buffer.from("not a zip")],
    ["a traversal entry", () => Buffer.from(zipSync({ "../escape.webp": strToU8("x") }))],
    ["an absolute entry", () => Buffer.from(zipSync({ "/etc/passwd": strToU8("x") }))],
    ["an SVG asset", () => Buffer.from(zipSync({ "assets/x.svg": strToU8("<svg/>") }))],
    ["no manifest", () => Buffer.from(zipSync({ "content.json": strToU8("{}") }))],
    ["invalid content", () => Buffer.from(zipSync({ "manifest.json": strToU8('{"bundleVersion":1,"assets":{}}'), "content.json": strToU8('{"pack":{}}') }))],
  ])("rejects %s with 422 and stores nothing", async (_label, body) => {
    const res = await fetch(`${admin}/admin-api/bundle-import`, { method: "POST", headers: { ...ADMIN, "content-type": "application/zip" }, body: body() })
    expect(res.status).toBe(422)
    expect((await res.json()).code).toBe("INVALID_BUNDLE")
    expect(storedAssets()).toEqual([])
  })

  it("rejects bundles over 64 MB with 413", async () => {
    const res = await fetch(`${admin}/admin-api/bundle-import`, { method: "POST", headers: { ...ADMIN, "content-type": "application/zip" }, body: Buffer.alloc(64 * 1024 * 1024 + 1) })
    expect(res.status).toBe(413)
  })
})

describe("pack library routes", () => {
  const draft = () => {
    const c = content()
    c.pack.id = "nebula"
    c.pack.name = "Nebula"
    return c
  }

  it("creates, reads and lists drafts; refuses duplicates, invalid shapes and unknown ids", async () => {
    const created = await fetch(`${admin}/admin-api/drafts`, json({ content: draft(), create: true }))
    expect([created.status, (await created.json()).ok]).toEqual([200, true])
    const again = await fetch(`${admin}/admin-api/drafts`, json({ content: draft(), create: true }))
    expect(again.status).toBe(422)
    expect((await again.json()).issues[0].path).toBe("pack.id")
    const invalid = await fetch(`${admin}/admin-api/drafts`, json({ content: { pack: { id: "x" } }, create: true }))
    expect(invalid.status).toBe(422)
    expect(((await (await fetch(`${admin}/admin-api/drafts/nebula`, { headers: ADMIN })).json()) as PackHead).content.pack.name).toBe("Nebula")
    expect((await fetch(`${admin}/admin-api/drafts/unknown`, { headers: ADMIN })).status).toBe(404)
    expect((await fetch(`${admin}/admin-api/drafts/..%2f..%2fetc`, { headers: ADMIN })).status).toBe(400)
    const packs = await (await fetch(`${admin}/admin-api/packs`, { headers: ADMIN })).json()
    expect(packs).toContainEqual({ id: "nebula", name: "Nebula", archived: false, published: null, draft: true })
    const wrongType = await fetch(`${admin}/admin-api/drafts`, { method: "POST", headers: { ...ADMIN, "content-type": "text/plain" }, body: "{}" })
    expect(wrongType.status).toBe(415)
  })

  it("archives drafts but not the active pack; rejects malformed bodies", async () => {
    await fetch(`${admin}/admin-api/drafts`, json({ content: draft(), create: true }))
    expect((await fetch(`${admin}/admin-api/archive`, json({ id: "starfall", archived: true }))).status).toBe(409)
    expect((await fetch(`${admin}/admin-api/archive`, json({ id: "nebula", archived: true }))).status).toBe(200)
    expect((await fetch(`${admin}/admin-api/archive`, json({ id: 5, archived: "yes" }))).status).toBe(409)
    expect((await fetch(`${admin}/admin-api/archive`, json({ id: "nebula", archived: false }))).status).toBe(200)
  })

  it("serves the JSON schema and reports missing images, including the resource picture", async () => {
    const schema = await (await fetch(`${admin}/admin-api/schema`, { headers: ADMIN })).json()
    expect(schema.properties).toHaveProperty("pack")
    const c = content()
    c.pack.cards[1].art = { src: `/art/managed/${"c".repeat(64)}.webp` }
    c.pack.resourceArt = { src: `/art/managed/${"d".repeat(64)}.webp` }
    const missing = await (await fetch(`${admin}/admin-api/missing-assets`, json(c))).json()
    expect(missing).toEqual([c.pack.cards[1].id, "resourceArt"])
    expect((await fetch(`${admin}/admin-api/missing-assets`, json({ pack: {} }))).status).toBe(422)
  })
})

describe("public rooms use only the default version", () => {
  async function publish(id: string, name: string, points = 15) {
    const c = content()
    c.pack.id = id
    c.pack.name = name
    c.rules.targetPoints = points
    const res = await fetch(`${admin}/admin-api/versions`, json({ content: c, note: name }))
    expect(res.status).toBe(201)
    return (await res.json()).version.id as string
  }
  const makeDefault = (id: string) => fetch(`${admin}/admin-api/active`, json({ id }))
  const create = (body: Record<string, unknown>) => fetch(`${game}/api/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Host", ...body }) })
  const roomContent = async (room: Response) => {
    const { code, token } = await room.json()
    return { code, token, content: await (await fetch(`${game}/api/rooms/${code}/content`, { headers: { authorization: `Bearer ${token}` } })).json() }
  }

  it("lists only the default; other published versions, drafts and archived packs are never offered", async () => {
    const nebula = await publish("nebula", "Nebula")
    await publish("starfall", "Starfall Academy", 16)
    await fetch(`${admin}/admin-api/drafts`, json({ content: { ...content(), pack: { ...content().pack, id: "drafty", name: "Drafty" } }, create: true }))
    expect(await (await fetch(`${game}/api/packs`)).json()).toEqual([{ id: "active", name: "Starfall Academy", packId: "starfall", default: true, title: "Starfall Academy", icon: null, description: "An original example pack: students of five elements at a fictional academy." }])
    expect((await makeDefault(nebula)).status).toBe(200)
    expect(await (await fetch(`${game}/api/packs`)).json()).toEqual([{ id: "active", name: "Nebula", packId: "nebula", default: true, title: "Starfall Academy", icon: null, description: "An original example pack: students of five elements at a fictional academy." }])
  })

  it("creates rooms on the default and refuses crafted requests for any other version", async () => {
    const nebula = await publish("nebula", "Nebula")
    const defaultId = (await (await fetch(`${admin}/admin-api/content`, { headers: ADMIN })).json()).active as string
    for (const body of [{}, { packVersion: "active" }]) {
      const room = await create(body)
      expect(room.status).toBe(201)
      expect((await roomContent(room)).content.pack.id).toBe("starfall")
    }
    // Inactive published versions are admin-only, even by exact id; so is the default's own id.
    for (const packVersion of [nebula, defaultId, "v99-missing", 42, { id: nebula }, "../../content/index", null]) {
      const res = await create({ packVersion })
      expect([res.status, (await res.json()).code]).toEqual([400, "INVALID_PACK"])
    }
  })

  it("keeps rooms on their pinned version after the default changes, including when its pack is archived", async () => {
    const waiting = await roomContent(await create({}))
    const nebula = await publish("nebula", "Nebula", 12)
    expect((await makeDefault(nebula)).status).toBe(200)
    await fetch(`${admin}/admin-api/archive`, json({ id: "starfall", archived: true }))
    // The waiting room is still Starfall: viewable, joinable, and it starts on Starfall.
    const auth = { authorization: `Bearer ${waiting.token}`, "content-type": "application/json" }
    expect((await (await fetch(`${game}/api/rooms/${waiting.code}`, { headers: auth })).json()).content).toMatchObject({ name: "Starfall Academy", targetPoints: 15 })
    expect((await fetch(`${game}/api/rooms/${waiting.code}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Guest" }) })).status).toBe(201)
    expect((await fetch(`${game}/api/rooms/${waiting.code}/start`, { method: "POST", headers: auth, body: "{}" })).status).toBe(200)
    expect((await (await fetch(`${game}/api/rooms/${waiting.code}/content`, { headers: auth })).json()).pack.id).toBe("starfall")
    // New rooms use the new default.
    expect((await roomContent(await create({}))).content.pack.id).toBe("nebula")
  })

  it("an installation with published versions but no default creates no rooms", async () => {
    await publish("nebula", "Nebula")
    const index = join(dataDir, "content", "index.json")
    const raw = JSON.parse(readFileSync(index, "utf8"))
    writeFileSync(index, JSON.stringify({ ...raw, active: null }))
    expect(await (await fetch(`${game}/api/packs`)).json()).toEqual([])
    const res = await create({})
    expect([res.status, (await res.json()).code]).toEqual([409, "NO_CONTENT"])
  })
})

it("accepts only X-Trovekit-Admin: 1 as the admin protection header", async () => {
  expect((await fetch(`${admin}/admin-api/packs`, { headers: { "x-trovekit-admin": "1" } })).status).toBe(200)
  for (const headers of [{}, { "x-trovekit-admin": "0" }, { "x-admin": "1" }] as Record<string, string>[]) {
    expect((await fetch(`${admin}/admin-api/packs`, { headers })).status).toBe(403)
  }
  expect((await fetch(`${game}/admin-api/packs`, { headers: { "x-trovekit-admin": "1" } })).status).toBe(404)
})

it("allocates unique pack IDs for concurrent name-only creation and preserves explicit existing IDs", async () => {
  const responses = await Promise.all(Array.from({ length: 3 }, () => fetch(`${admin}/admin-api/drafts`, json({ create: true, name: "New Theme" }))))
  expect(responses.map(r => r.status)).toEqual([200, 200, 200])
  const created = await Promise.all(responses.map(r => r.json()))
  expect(created.map(c => c.content.pack.id).sort()).toEqual(["new-theme", "new-theme-2", "new-theme-3"])
  expect((await fetch(`${admin}/admin-api/drafts`, json({ create: true, name: " " }))).status).toBe(422)
  const draft = created[0].content
  draft.pack.name = "Changed name"
  expect((await fetch(`${admin}/admin-api/drafts`, json({ content: draft, revision: created[0].revision }))).status).toBe(200)
  expect((await (await fetch(`${admin}/admin-api/drafts/${draft.pack.id}`, { headers: ADMIN })).json()).content.pack.name).toBe("Changed name")
})
