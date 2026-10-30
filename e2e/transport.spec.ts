import { expect, test, type Browser } from "./browser-fixtures"
import { once } from "node:events"
import { readFileSync, rmSync } from "node:fs"
import { request as upstreamRequest, type Server } from "node:http"
import { createServer as createTlsServer } from "node:https"
import { connect, type AddressInfo, type Socket } from "node:net"
import { networkInterfaces } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { createGameServer } from "../server/game-server"
import { fixtureDataDir } from "../tests/fixtures"
import { PHONE, uiTurn } from "./helpers"

async function listen(server: Server, host = "127.0.0.1") {
  server.listen(0, host)
  await once(server, "listening")
  return (server.address() as AddressInfo).port
}

async function playAndReconnect(browser: Browser, baseURL: string, game: ReturnType<typeof createGameServer>, secure: boolean) {
  const host = game.rooms.create("Transport host"), guest = game.rooms.join(host.code, "Transport guest")
  game.rooms.start(host.code, host.token)
  const before = game.rooms.view(host.code, host.token)
  const active = [host, guest].find(s => s.playerId === before.game!.players[before.game!.active].id)!
  const context = await browser.newContext({ baseURL, viewport: PHONE, ignoreHTTPSErrors: secure })
  try {
    await context.addInitScript(({ code, playerId, token }) => {
      localStorage.setItem(`trovekit:session:${code}`, JSON.stringify({ playerId, token }))
    }, active)
    const page = await context.newPage()
    const errors: string[] = [], sockets: string[] = []
    let roomFrames = 0
    page.on("pageerror", e => errors.push(e.message))
    page.on("websocket", ws => {
      sockets.push(ws.url())
      ws.on("framereceived", frame => { if (JSON.parse(String(frame.payload)).type === "room") roomFrames++ })
    })
    await page.goto(`/r/${host.code}`)
    expect(await page.evaluate(() => window.isSecureContext)).toBe(secure)
    if (!secure) expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe("undefined")
    await expect.poll(() => roomFrames).toBeGreaterThan(0)
    await uiTurn(page)
    await expect.poll(() => game.rooms.view(host.code, host.token).revision).toBe(before.revision + 1)
    // Drop a live connection: the application must reconnect with the same session.
    const framesBefore = roomFrames
    for (const ws of game.wss.clients) ws.terminate()
    await expect.poll(() => sockets.length).toBeGreaterThan(1)
    await expect.poll(() => roomFrames).toBeGreaterThan(framesBefore)
    await page.reload()
    await expect(page.getByRole("button", { name: "Game menu" })).toBeVisible()
    expect(sockets.every(url => url.startsWith(secure ? "wss://" : "ws://"))).toBe(true)
    expect(errors).toEqual([])
    expect((await context.request.get("/readyz")).status()).toBe(200)
    expect((await context.request.get("/admin-api/content")).status()).toBe(404)
  } finally { await context.close() }
}

test("phone viewport can play and reconnect over ordinary LAN HTTP without randomUUID", async ({ browser }) => {
  const ip = Object.values(networkInterfaces()).flat().find(a => a?.family === "IPv4" && !a.internal)?.address
  test.skip(!ip, "No non-loopback IPv4 interface is available")
  const dataDir = fixtureDataDir("trovekit-lan-browser-")
  const game = createGameServer({ dataDir, staticDir: resolve("dist") })
  try {
    const port = await listen(game.server, "0.0.0.0")
    await playAndReconnect(browser, `http://${ip}:${port}`, game, false)
  } finally { await game.close(); rmSync(dataDir, { recursive: true, force: true }) }
})

test("HTTPS/WSS proxy preserves gameplay, trusted client IP and reconnects", async ({ browser }) => {
  const dataDir = fixtureDataDir("trovekit-tls-browser-")
  let game: ReturnType<typeof createGameServer> | undefined
  let proxy: ReturnType<typeof createTlsServer> | undefined
  const sockets = new Set<Socket>()
  try {
    const key = join(dataDir, "test.key"), cert = join(dataDir, "test.pem")
    const generated = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { encoding: "utf8" })
    expect(generated.status, generated.stderr || generated.error?.message).toBe(0)
    let backendPort = 0
    proxy = createTlsServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
      const upstream = upstreamRequest({ host: "127.0.0.1", port: backendPort, path: req.url, method: req.method, headers: { ...req.headers, "x-forwarded-for": req.socket.remoteAddress! } }, incoming => {
        res.writeHead(incoming.statusCode!, incoming.headers)
        incoming.pipe(res)
      })
      upstream.on("error", () => res.destroy())
      req.pipe(upstream)
    })
    proxy.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => socket.destroy()) })
    proxy.on("upgrade", (req, socket, head) => {
      const upstream = connect(backendPort, "127.0.0.1", () => {
        const headers = { ...req.headers, "x-forwarded-for": req.socket.remoteAddress! }
        upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n`)
        if (head.length) upstream.write(head)
        socket.pipe(upstream).pipe(socket)
      })
      upstream.on("error", () => socket.destroy())
      socket.on("error", () => upstream.destroy())
      socket.on("close", () => upstream.destroy())
    })
    const origin = `https://127.0.0.1:${await listen(proxy)}`
    game = createGameServer({ dataDir, staticDir: resolve("dist"), publicOrigin: origin, trustedProxies: ["127.0.0.1"] })
    backendPort = await listen(game.server)
    await playAndReconnect(browser, origin, game, true)
  } finally {
    for (const socket of sockets) socket.destroy()
    if (proxy?.listening) await new Promise<void>(resolveClose => proxy!.close(() => resolveClose()))
    await game?.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
})
