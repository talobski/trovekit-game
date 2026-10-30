import { z } from "zod"
import { ContentSchema, packImages, validateContent } from "../src/shared/content.ts"
import { exportBundle, importBundle, BUNDLE_LIMIT } from "./bundles.ts"
import { readImageZip } from "./image-zip.ts"
import { IMAGE_LIMITS } from "../src/shared/image-credits.ts"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { assetBytes, IMAGE_LIMIT, prepareImage, readBytes, serveAsset, storeImage } from "./assets.ts"
import { ContentStore, type DraftResult, type PublishResult } from "./content-store.ts"
import { boundHttpConnections, resolveLimits } from "./limits.ts"
import { shutdownServer } from "./shutdown.ts"
import { serveStatic } from "./static.ts"
import { HttpError, readJson, sendJson, requestPath, rejectUpgrade } from "./http.ts"

/*
 * Private content admin. Runs as its own process, bound to 127.0.0.1 only, and
 * is never mounted on the game server. Requests must come from a localhost Host
 * (blocks DNS rebinding) and carry the X-Trovekit-Admin header (blocks
 * cross-site form posts, since browsers preflight custom headers and this
 * server never answers CORS).
 */

export const ADMIN_HOST = "127.0.0.1"
export const IMPORT_LIMIT = 1024 * 1024

export interface AdminServerOptions {
  dataDir: string
  port: number
  staticDir?: string
  fallback?: (req: IncomingMessage, res: ServerResponse) => void
}

/** 409 with the current revision when the pack changed since the editor loaded it. */
function sendDraftResult(res: ServerResponse, result: DraftResult | PublishResult, okStatus = 200) {
  if (result.ok) return sendJson(res, okStatus, result)
  if ("conflict" in result) return sendJson(res, 409, { code: "DRAFT_CONFLICT", message: "This pack changed in another tab or window since you opened it", revision: result.revision })
  return sendJson(res, 422, result)
}

export function createAdminServer(options: AdminServerOptions) {
  let closing = false
  const store = new ContentStore(options.dataDir)
  const allowedHosts = new Set([`127.0.0.1:${options.port}`, `localhost:${options.port}`])

  async function api(req: IncomingMessage, res: ServerResponse, path: string) {
    if (req.headers["x-trovekit-admin"] !== "1") throw new HttpError(403, "FORBIDDEN", "Missing admin header")
    const method = req.method ?? "GET"
    if (path === "/admin-api/missing-assets" && method === "POST") {
      const checked = validateContent(await readJson(req, IMPORT_LIMIT))
      if (!checked.ok) return sendJson(res, 422, checked)
      return sendJson(res, 200, packImages(checked.content.pack).filter((i) => !assetBytes(options.dataDir, i.src)).map((i) => i.owner))
    }
    if (path === "/admin-api/schema" && method === "GET") return sendJson(res, 200, z.toJSONSchema(ContentSchema, { unrepresentable: "any" }))
    if (path === "/admin-api/packs" && method === "GET") return sendJson(res, 200, store.catalog())
    if (path === "/admin-api/drafts" && method === "POST") {
      const body = await readJson(req, IMPORT_LIMIT) as { content?: unknown; create?: boolean; name?: unknown; revision?: unknown }
      if (body.create === true && "name" in body) {
        const created = store.createDraft(body.name, body.content)
        return sendJson(res, created.ok ? 200 : 422, created)
      }
      // A new pack has no revision yet; an existing pack's draft is saved only over the revision the editor loaded.
      const base = body.create === true ? null : typeof body.revision === "string" ? body.revision : undefined
      if (base === undefined) throw new HttpError(400, "REVISION_REQUIRED", "Reload the pack before saving its draft")
      return sendDraftResult(res, store.saveDraft(body.content, base))
    }
    if (path === "/admin-api/archive" && method === "POST") {
      const body = await readJson(req, 4096) as { id?: unknown; archived?: unknown }
      if (typeof body.id !== "string" || typeof body.archived !== "boolean" || !store.archive(body.id, body.archived)) throw new HttpError(409, "ARCHIVE_BLOCKED", "Select a different default pack before archiving this pack")
      return sendJson(res, 200, { ok: true })
    }
    const draft = path.match(/^\/admin-api\/drafts\/([a-z0-9_-]{1,48})$/)
    if (draft && method === "GET") {
      const head = store.head(draft[1])
      if (!head) throw new HttpError(404, "NOT_FOUND", "Pack not found")
      return sendJson(res, 200, head)
    }
    if (path === "/admin-api/bundle-import" && method === "POST") return sendJson(res, 200, await importBundle(options.dataDir, await readBytes(req, BUNDLE_LIMIT)))
    if (path === "/admin-api/bundle-export" && method === "POST") {
      const content = validateContent(await readJson(req, IMPORT_LIMIT))
      if (!content.ok) return sendJson(res, 422, content)
      const bytes = exportBundle(options.dataDir, content.content)
      res.writeHead(200, { "content-type": "application/zip", "x-content-type-options": "nosniff" }); return res.end(bytes)
    }
    if (path === "/admin-api/image-zip" && method === "POST") return sendJson(res, 200, await readImageZip(options.dataDir, await readBytes(req, IMAGE_LIMITS.batchBytes)))
    if (path === "/admin-api/assets" && method === "POST") {
      const filename = new URL(req.url!, "http://local").searchParams.get("filename") ?? ""
      const image = await prepareImage(await readBytes(req, IMAGE_LIMIT), filename)
      storeImage(options.dataDir, image)
      return sendJson(res, 201, { src: image.src, width: image.width, height: image.height })
    }
    if (path === "/admin-api/content" && method === "GET") {
      return sendJson(res, 200, { ...store.list(), activeHash: store.active()?.hash ?? null })
    }
    const v = path.match(/^\/admin-api\/versions\/([a-z0-9-]{1,64})$/)
    if (v && method === "GET") {
      const content = store.get(v[1])
      if (!content) throw new HttpError(404, "NOT_FOUND", "Version not found")
      return sendJson(res, 200, content)
    }
    if (path === "/admin-api/validate" && method === "POST") {
      const checked = validateContent(await readJson(req, IMPORT_LIMIT))
      return sendJson(res, 200, checked.ok ? { ok: true, issues: [] } : checked)
    }
    if (path === "/admin-api/versions" && method === "POST") {
      const body = (await readJson(req, IMPORT_LIMIT)) as { content?: unknown; note?: unknown; activate?: unknown; revision?: unknown }
      // Publishing never changes the default. The old `activate: true` is refused rather than ignored, so no caller is surprised.
      if (body.activate === true) throw new HttpError(400, "ACTIVATE_SEPARATELY", "Publishing no longer changes the default. Publish, then make the version the default with POST /admin-api/active.")
      const base = typeof body.revision === "string" || body.revision === null ? body.revision : undefined
      return sendDraftResult(res, store.publish(body.content, typeof body.note === "string" ? body.note : "", base), 201)
    }
    if (path === "/admin-api/active" && method === "POST") {
      const body = (await readJson(req, 4096)) as { id?: unknown }
      const result = typeof body.id === "string" ? store.activate(body.id) : { ok: false as const, code: "NOT_FOUND" as const }
      if (!result.ok && result.code === "ARCHIVED") throw new HttpError(409, "PACK_ARCHIVED", "Restore this pack before making one of its versions the default")
      if (!result.ok) throw new HttpError(404, "NOT_FOUND", "Version not found")
      return sendJson(res, 200, { ok: true, active: body.id })
    }
    throw new HttpError(404, "NOT_FOUND", "Not found")
  }

  const server = createServer(async (req, res) => {
    try {
      if (closing) { res.setHeader("connection", "close"); return sendJson(res, 503, { ok: false }) }
      const path = requestPath(req)
      if (!allowedHosts.has(req.headers.host ?? "")) throw new HttpError(403, "FORBIDDEN", "Admin is only available on localhost")
      if (serveAsset(options.dataDir, path, res)) return
      if (path.startsWith("/admin-api/")) return await api(req, res, path)
      if (options.fallback) {
        if (path === "/" || path === "/index.html") req.url = "/admin.html"
        return options.fallback(req, res)
      }
      if (options.staticDir) return serveStatic(req, res, options.staticDir, path, "admin.html")
      sendJson(res, 404, { code: "NOT_FOUND", message: "Not found" })
    } catch (e) {
      if (e instanceof HttpError) return sendJson(res, e.status, { code: e.code, message: e.message })
      console.error(e)
      sendJson(res, 500, { code: "SERVER_ERROR", message: "Something went wrong" })
    }
  })

  server.on("upgrade", (_req, socket) => rejectUpgrade(socket, 404))

  // Keep the private admin's existing large uploads viable over an SSH tunnel.
  const connections = boundHttpConnections(server, resolveLimits({ maxConnections: 64, connectionsPerIp: 64, requestTimeoutMs: 120_000, headersTimeoutMs: 10_000, connectionIdleMs: 120_000 }))
  let shutdown: Promise<void> | undefined
  const close = () => shutdown ??= shutdownServer(server, () => { closing = true }, connections.destroy)
  return { server, store, close, listen: (cb?: () => void) => server.listen(options.port, ADMIN_HOST, cb) }
}
