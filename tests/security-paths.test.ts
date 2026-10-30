import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { connect, type AddressInfo } from "node:net"
import type { Server } from "node:http"
import { afterEach, describe, expect, it } from "vitest"
import { createGameServer } from "../server/game-server"
import { createAdminServer } from "../server/admin-server"

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanups.splice(0)) await close() })

async function start(admin: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "trovekit-paths-"))
  const dist = join(dir, "dist")
  mkdirSync(dist); mkdirSync(join(dir, "dist-private"))
  writeFileSync(join(dist, "index.html"), "game page")
  writeFileSync(join(dist, "admin.html"), "admin page")
  writeFileSync(join(dir, "dist-private", "secret.txt"), "private sentinel")
  symlinkSync(join(dir, "dist-private"), join(dist, "linked-directory"))
  symlinkSync(join(dir, "dist-private", "secret.txt"), join(dist, "linked.txt"))
  symlinkSync(join(dist, "index.html"), join(dist, "internal-link.html"))
  const { server } = admin ? createAdminServer({ dataDir: join(dir, "data"), staticDir: dist, port: 0 }) : createGameServer({ dataDir: join(dir, "data"), staticDir: dist })
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r))
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); rmSync(dir, { recursive: true, force: true }) })
  return server
}

function raw(server: Server, path: string, upgrade = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect((server.address() as AddressInfo).port, "127.0.0.1")
    let result = ""
    socket.setTimeout(2000, () => socket.destroy(new Error("rejected connection did not close")))
    socket.on("error", reject)
    socket.on("data", chunk => { result += chunk })
    socket.on("end", () => resolve(result))
    socket.on("connect", () => socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost:0\r\n${upgrade ? "Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" : "Connection: close\r\n"}\r\n`))
  })
}

for (const admin of [false, true]) describe(admin ? "admin path boundary" : "game path boundary", () => {
  it.each(["/%2e%2e/secret.txt", "/../dist-private/secret.txt", "/%2e%2e%2fdist-private/secret.txt", "/%252e%252e%252fdist-private/secret.txt", "/%00", "/%ff", "/%", "/x?bad=%zz", "/a\\b", "http://[", "//[", "/#fragment"])("rejects %s without terminating the server", async path => {
    const server = await start(admin)
    const response = await raw(server, path)
    expect(response).toMatch(/^HTTP\/1.1 400/)
    expect(response).not.toContain("private sentinel")
    expect(await raw(server, "/")).toContain(admin ? "admin page" : "game page")
  })
  it.each(["/linked.txt", "/linked-directory/secret.txt", "/internal-link.html"])("rejects symlink %s", async path => {
    const server = await start(admin)
    expect(await raw(server, path)).toMatch(/^HTTP\/1.1 403/)
  })
  it("closes malformed and unsupported upgrade requests", async () => {
    const server = await start(admin)
    expect(await raw(server, "http://[", true)).toMatch(/^HTTP\/1.1 (400|404)/)
    expect(await raw(server, "/unavailable", true)).toMatch(/^HTTP\/1.1 404/)
    expect(await raw(server, "/")).toContain(admin ? "admin page" : "game page")
  })
})

it("does not expose the admin through an encoded route", async () => {
  const server = await start(false)
  expect(await raw(server, "/%61dmin.html")).toMatch(/^HTTP\/1.1 404/)
})
