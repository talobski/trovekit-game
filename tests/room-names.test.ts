import { readFileSync, writeFileSync } from "node:fs"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createGameServer } from "../server/game-server"
import { fixtureDataDir } from "./fixtures"

const open: (() => void)[] = []
afterEach(() => {
  while (open.length) open.pop()!()
})

async function start(dataDir = fixtureDataDir("trovekit-names-")) {
  const g = createGameServer({ dataDir, botDelayMs: 60_000 })
  await new Promise<void>((r) => g.server.listen(0, "127.0.0.1", r))
  open.push(() => (g.server.closeAllConnections(), g.server.close()))
  return { base: `http://127.0.0.1:${(g.server.address() as AddressInfo).port}`, dataDir }
}

const post = async (base: string, path: string, body: unknown, token?: string) => {
  const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
  return { status: res.status, body: await res.json() }
}
const get = async (base: string, path: string, token?: string) => (await fetch(base + path, { headers: token ? { authorization: `Bearer ${token}` } : {} })).json()

describe("room names", () => {
  it("defaults to Trovekit Game Room when blank or missing", async () => {
    const { base } = await start()
    for (const roomName of [undefined, "", "   "]) {
      const r = await post(base, "/api/rooms", { name: "Ana", roomName })
      expect(r.status).toBe(201)
      expect((await get(base, `/api/rooms/${r.body.code}`, r.body.token)).name).toBe("Trovekit Game Room")
    }
  })

  it("keeps a custom name, shown to invitees, and keeps the creator's player name", async () => {
    const { base, dataDir } = await start()
    const host = await post(base, "/api/rooms", { name: "Ana", roomName: "  Friday   Night <b>Games</b> " })
    const view = await get(base, `/api/rooms/${host.body.code}`, host.body.token)
    expect(view.name).toBe("Friday Night bGames/b")
    expect(view.players.map((p: { name: string }) => p.name)).toEqual(["Ana"])
    expect((await get(base, `/api/rooms/${host.body.code}/preview`)).name).toBe("Friday Night bGames/b")
    const file = JSON.parse(readFileSync(join(dataDir, "rooms", `${host.body.code}.json`), "utf8"))
    expect(file.name).toBe("Friday Night bGames/b")
  })

  it("rejects names that are too long or not text", async () => {
    const { base } = await start()
    expect((await post(base, "/api/rooms", { name: "Ana", roomName: "x".repeat(41) })).body.code).toBe("INVALID_ROOM_NAME")
    expect((await post(base, "/api/rooms", { name: "Ana", roomName: 42 })).body.code).toBe("INVALID_ROOM_NAME")
    expect((await post(base, "/api/rooms", { roomName: "Named but nameless host" })).body.code).toBe("INVALID_NAME")
  })

})

describe("saved room format", () => {
  it("writes formatVersion 2, and skips rooms in any other format without touching them", async () => {
    const first = await start()
    const kept = await post(first.base, "/api/rooms", { name: "Ana", roomName: "Current" })
    const old = await post(first.base, "/api/rooms", { name: "Ben", roomName: "Old" })
    const none = await post(first.base, "/api/rooms", { name: "Cy", roomName: "Unversioned" })
    open.pop()!()
    const file = (code: string) => join(first.dataDir, "rooms", `${code}.json`)
    expect(JSON.parse(readFileSync(file(kept.body.code), "utf8")).formatVersion).toBe(2)
    // A room in the old shape (as written before Schema v2), and one with no version at all.
    const v1 = JSON.parse(readFileSync(file(old.body.code), "utf8"))
    Object.assign(v1, { formatVersion: 1, game: { players: [{ id: "x", tokens: {}, signed: [] }], log: [{ type: "sign" }] } })
    writeFileSync(file(old.body.code), JSON.stringify(v1))
    const unversioned = JSON.parse(readFileSync(file(none.body.code), "utf8"))
    delete unversioned.formatVersion
    writeFileSync(file(none.body.code), JSON.stringify(unversioned))
    const before = [readFileSync(file(old.body.code), "utf8"), readFileSync(file(none.body.code), "utf8")]

    const second = await start(first.dataDir)
    expect((await get(second.base, `/api/rooms/${kept.body.code}`, kept.body.token)).name).toBe("Current")
    for (const { body } of [old, none]) {
      const res = await fetch(`${second.base}/api/rooms/${body.code}`, { headers: { authorization: `Bearer ${body.token}` } })
      expect([res.status, (await res.json()).code]).toEqual([404, "ROOM_NOT_FOUND"])
    }
    // Skipped files stay exactly as they were.
    expect([readFileSync(file(old.body.code), "utf8"), readFileSync(file(none.body.code), "utf8")]).toEqual(before)
  })
})
