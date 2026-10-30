import { fileURLToPath } from "node:url"
import { serverConfig, prepareDataDirectory } from "./config.ts"
import { installShutdown } from "./shutdown.ts"
import { createGameServer } from "./game-server.ts"

const root = fileURLToPath(new URL("..", import.meta.url))
const dev = process.argv.includes("--dev")
let config: ReturnType<typeof serverConfig>
try { config = serverConfig(root, process.env, false, dev); prepareDataDirectory(config.dataDir) }
catch (e) { console.error(`Configuration error: ${(e as Error).message}`); process.exit(1) }
const { port, host, dataDir } = config

let closeVite: (() => Promise<void>) | undefined
let fallback
if (dev) {
  const { createServer } = await import("vite")
  const vite = await createServer({ root, server: { middlewareMode: true, ws: { port: port + 10 } }, appType: "spa" })
  closeVite = () => vite.close()
  fallback = (req: Parameters<typeof vite.middlewares>[0], res: Parameters<typeof vite.middlewares>[1]) => {
    // The admin page is only served by the local admin server.
    if (req.url?.startsWith("/admin")) {
      res.statusCode = 404
      return res.end("Not found")
    }
    vite.middlewares(req, res)
  }
}

let game: ReturnType<typeof createGameServer>
try { game = createGameServer({ ...config, staticDir: dev ? undefined : `${root}dist`, fallback }) }
catch (e) { console.error(`Startup error: ${(e as Error).message}`); await closeVite?.(); process.exit(1) }
installShutdown(async () => { await game.close(); await closeVite?.() })
game.server.once("error", async error => { console.error(`Listen error: ${error.message}`); await game.close(); await closeVite?.(); process.exitCode = 1 })
game.server.listen(port, host, () => {
  console.log(`Trovekit Game server: http://${host}:${port}${dev ? " (dev)" : ""}`)
  console.log(`Data directory: ${dataDir}`)
})
