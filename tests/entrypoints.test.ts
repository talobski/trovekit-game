import { spawn, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer, connect, type AddressInfo } from "node:net"
import { networkInterfaces, tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"

async function unusedPort() {
  const server = createServer().listen(0, "127.0.0.1")
  await once(server, "listening")
  const port = (server.address() as AddressInfo).port
  await new Promise<void>(resolve => server.close(() => resolve()))
  return port
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, "exit")
  const force = setTimeout(() => child.kill("SIGKILL"), 8000)
  child.kill("SIGTERM")
  try { expect((await exited)[0], "graceful child exit").toBe(0) }
  finally { clearTimeout(force) }
}

async function reachable(host: string, port: number) {
  return new Promise<boolean>(resolve => {
    const socket = connect({ host, port })
    const done = (value: boolean) => { socket.destroy(); resolve(value) }
    socket.once("connect", () => done(true))
    socket.once("error", () => done(false))
    socket.setTimeout(1000, () => done(false))
  })
}

it.each([false, true])("starts and stops the empty-library development entrypoint (admin=%s)", async admin => {
  const dataDir = mkdtempSync(join(tmpdir(), "trovekit-entrypoint-")), port = await unusedPort()
  const env: NodeJS.ProcessEnv = { ...process.env, TROVEKIT_DATA: dataDir, HOST: "127.0.0.1", PORT: String(port), ADMIN_PORT: String(port) }
  delete env.PUBLIC_ORIGIN; delete env.TRUSTED_PROXIES
  const child = spawn(process.execPath, ["--import", "tsx", admin ? "server/admin-main.ts" : "server/main.ts", "--dev"], { env, stdio: ["ignore", "pipe", "pipe"] })
  let output = ""
  child.stdout!.on("data", data => { output += data })
  child.stderr!.on("data", data => { output += data })
  try {
    await expect.poll(() => {
      if (child.exitCode !== null) throw new Error(output)
      return output.includes("Data directory:")
    }, { timeout: 20_000 }).toBe(true)
    const response = await fetch(`http://127.0.0.1:${port}/`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain("/@vite/client")
    expect(await reachable("127.0.0.1", port + 10)).toBe(true)
    if (admin) {
      const ip = Object.values(networkInterfaces()).flat().find(a => a?.family === "IPv4" && !a.internal)?.address
      if (ip) {
        expect(await reachable(ip, port)).toBe(false)
        expect(await reachable(ip, port + 10)).toBe(false)
      }
    } else {
      expect(await (await fetch(`http://127.0.0.1:${port}/api/packs`)).json()).toEqual([])
    }
    await stop(child)
    expect(await reachable("127.0.0.1", port)).toBe(false)
    expect(await reachable("127.0.0.1", port + 10)).toBe(false)
  } finally { await stop(child); rmSync(dataDir, { recursive: true, force: true }) }
}, 30_000)
