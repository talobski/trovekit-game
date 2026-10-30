import { fileURLToPath } from "node:url"
import { serverConfig, prepareDataDirectory } from "./config.ts"
import { installShutdown } from "./shutdown.ts"
import { ADMIN_HOST, createAdminServer } from "./admin-server.ts"

const root = fileURLToPath(new URL("..", import.meta.url))
const dev = process.argv.includes("--dev")
let config: ReturnType<typeof serverConfig>
try { config = serverConfig(root, process.env, true, dev); prepareDataDirectory(config.dataDir) }
catch (e) { console.error(`Configuration error: ${(e as Error).message}`); process.exit(1) }
const { port, dataDir } = config

let closeVite: (() => Promise<void>) | undefined
let fallback
if (dev) {
  const { createServer } = await import("vite")
  const vite = await createServer({ root, server: { middlewareMode: true, ws: { host: ADMIN_HOST, port: port + 10 } }, appType: "mpa" })
  closeVite = () => vite.close()
  fallback = vite.middlewares
}

let admin: ReturnType<typeof createAdminServer>
try { admin = createAdminServer({ dataDir, port, staticDir: dev ? undefined : `${root}dist`, fallback }) }
catch (e) { console.error(`Startup error: ${(e as Error).message}`); await closeVite?.(); process.exit(1) }
installShutdown(async () => { await admin.close(); await closeVite?.() })
admin.server.once("error", async error => { console.error(`Listen error: ${error.message}`); await admin.close(); await closeVite?.(); process.exitCode = 1 })
admin.listen(() => {
  console.log(`Trovekit Game admin (local only): http://${ADMIN_HOST}:${port}`)
  console.log(`Data directory: ${dataDir}`)
})
