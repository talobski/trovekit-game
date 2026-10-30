import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AddressInfo } from "node:net"
import { once } from "node:events"
import WebSocket from "ws"
import { afterEach, expect, it, vi } from "vitest"
import { createGameServer } from "../server/game-server"
import { ContentStore } from "../server/content-store"
import * as persistence from "../server/content-store"
import { RoomService } from "../server/rooms"
import { fixtureDataDir } from "./fixtures"

const disposals: (() => void | Promise<void>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const f of disposals.splice(0)) await f() })
function service() {
  const dir = fixtureDataDir("trovekit-recovery-")
  const store = new ContentStore(dir), rooms = new RoomService(dir, store, { botDelayMs: 60_000 })
  disposals.push(() => { rooms.dispose(); rmSync(dir, { recursive: true, force: true }) })
  return { dir, store, rooms }
}
function failWrite() {
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(persistence, "writeJsonAtomic").mockImplementationOnce(() => { throw new Error("ENOSPC: test disk failure") })
}
it("does not publish or retain a room whose initial save failed", () => {
  const { dir, rooms } = service()
  const changed = vi.fn(); rooms.onChange(changed)
  failWrite()
  expect(() => rooms.create("Host")).toThrow(/could not save/)
  expect(readdirSync(join(dir, "rooms"))).toEqual([])
  expect(changed).not.toHaveBeenCalled()
  expect(rooms.healthy).toBe(false)
  rooms.create("Host")
  expect(rooms.healthy).toBe(true)
})
it("keeps disk, in-memory revision and broadcasts unchanged after an action save fails", () => {
  const { dir, rooms } = service()
  const host = rooms.create("Host"), guest = rooms.join(host.code, "Guest")
  rooms.start(host.code, host.token)
  const before = rooms.view(host.code, host.token)
  const path = join(dir, "rooms", `${host.code}.json`), saved = readFileSync(path, "utf8")
  const player = [host, guest].find(p => p.playerId === before.game!.players[before.game!.active].id)!
  const action = { actionId: "test-action-id", expectedRevision: 0, action: { type: "collect", take: Object.fromEntries(Object.keys(before.game!.supply.resources).slice(0, 3).map(k => [k, 1])) } }
  const changed = vi.fn(); rooms.onChange(changed)
  failWrite()
  expect(() => rooms.act(host.code, player.token, action)).toThrow(/could not save/)
  expect(rooms.view(host.code, host.token)).toEqual(before)
  expect(readFileSync(path, "utf8")).toBe(saved)
  expect(changed).not.toHaveBeenCalled()
  expect(rooms.act(host.code, player.token, action).revision).toBe(1)
})
it("does not revoke membership when saving a lobby leave fails", () => {
  const { rooms } = service()
  const host = rooms.create("Host"), guest = rooms.join(host.code, "Guest")
  failWrite()
  expect(() => rooms.leave(host.code, guest.token)).toThrow(/could not save/)
  expect(rooms.authenticate(host.code, guest.token).player.id).toBe(guest.playerId)
})
it("retains the last human's session and marks readiness unhealthy if deletion fails", () => {
  const { dir, rooms } = service()
  const host = rooms.create("Host")
  vi.spyOn(console, "error").mockImplementation(() => {})
  const path = join(dir, "rooms", `${host.code}.json`)
  renameSync(path, `${path}.backup`)
  mkdirSync(path) // rmSync without recursive removal must fail on this directory.
  expect(() => rooms.leave(host.code, host.token)).toThrow(/could not save/)
  expect(rooms.healthy).toBe(false)
  expect(rooms.authenticate(host.code, host.token).player.id).toBe(host.playerId)
  rmSync(path, { recursive: true })
  renameSync(`${path}.backup`, path)
  rooms.leave(host.code, host.token)
  expect(rooms.hasSession(host.code, host.playerId)).toBe(false)
  expect(rooms.healthy).toBe(true)
})
it.each(["token hash", "filename", "game state", "content hash"])("skips corrupt %s without rewriting the saved file", kind => {
  const { dir, store, rooms } = service()
  const host = rooms.create("Host"); rooms.join(host.code, "Guest"); rooms.start(host.code, host.token)
  const path = join(dir, "rooms", `${host.code}.json`)
  const bad = JSON.parse(readFileSync(path, "utf8"))
  if (kind === "token hash") bad.players[0].tokenHash = "bad"
  if (kind === "filename") bad.code = "ABCDEF" === host.code ? "BCDEFG" : "ABCDEF"
  if (kind === "game state") bad.game.active = 20
  if (kind === "content hash") bad.snapshot.hash = "0".repeat(64)
  const bytes = JSON.stringify(bad); writeFileSync(path, bytes)
  vi.spyOn(console, "error").mockImplementation(() => {})
  const restarted = new RoomService(dir, store)
  disposals.unshift(() => restarted.dispose())
  expect(restarted.getRoom(host.code)).toBeUndefined()
  expect(restarted.healthy).toBe(false)
  expect(readFileSync(path, "utf8")).toBe(bytes)
})
it("fails clearly on a corrupt content index without replacing it", () => {
  const { dir } = service()
  const path = join(dir, "content", "index.json")
  writeFileSync(path, "broken index")
  expect(() => new ContentStore(dir)).toThrow(/Content index is invalid/)
  expect(readFileSync(path, "utf8")).toBe("broken index")
})
it("reports an empty library as ready and drains WebSockets on shutdown", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trovekit-health-"))
  const g = createGameServer({ dataDir: dir })
  disposals.push(async () => { await g.close(); rmSync(dir, { recursive: true, force: true }) })
  await new Promise<void>(r => g.server.listen(0, "127.0.0.1", r))
  const base = `http://127.0.0.1:${(g.server.address() as AddressInfo).port}`
  expect((await fetch(base + "/healthz")).status).toBe(200)
  expect((await fetch(base + "/readyz")).status).toBe(200)
  expect(await (await fetch(base + "/api/packs")).json()).toEqual([])
  const ws = new WebSocket(base.replace("http", "ws") + "/ws")
  await once(ws, "open")
  const closed = once(ws, "close")
  await g.close()
  expect((await closed)[0]).toBe(1001)
})
it("readiness exposes failed persistence without leaking error details", async () => {
  const { dir } = service()
  const g = createGameServer({ dataDir: dir })
  disposals.unshift(() => g.close())
  await new Promise<void>(r => g.server.listen(0, "127.0.0.1", r))
  const base = `http://127.0.0.1:${(g.server.address() as AddressInfo).port}`
  failWrite()
  expect(() => g.rooms.create("Host")).toThrow()
  const response = await fetch(base + "/readyz")
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({ ok: false })
  expect((await fetch(base + "/healthz")).status).toBe(200)
})
