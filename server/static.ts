import { constants, closeSync, createReadStream, fstatSync, lstatSync, openSync, realpathSync } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { HttpError } from "./http.ts"

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".webp": "image/webp", ".jpg": "image/jpeg", ".woff2": "font/woff2",
  ".json": "application/json", ".ico": "image/x-icon",
}

/** The configured root may be a deployment symlink. No symlinks below it are
 * served, even when their targets are inside the root. The build tree must be
 * owned by the operator and must never be writable by upload/game clients.
 */
function checkedFile(root: string, path: string): string | null {
  const file = resolve(root, `.${path}`)
  const rel = relative(root, file)
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new HttpError(403, "FORBIDDEN", "Path is outside the static directory")
  let current = root
  for (const component of rel.split(sep).filter(Boolean)) {
    current = join(current, component)
    try {
      const stat = lstatSync(current)
      if (stat.isSymbolicLink()) throw new HttpError(403, "FORBIDDEN", "Static symlinks are not served")
    } catch (e) {
      if (["ENOENT", "ENOTDIR"].includes((e as NodeJS.ErrnoException).code ?? "")) return null
      throw e
    }
  }
  return lstatSync(file).isFile() ? file : null
}

export function serveStatic(req: IncomingMessage, res: ServerResponse, directory: string, path: string, entry: string) {
  if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "METHOD", "Method not allowed")
  let root: string
  try { root = realpathSync(directory) } catch { throw new HttpError(503, "BUILD_MISSING", "Build the application before starting this server") }
  const file = checkedFile(root, path) ?? checkedFile(root, `/${entry}`)
  if (!file) throw new HttpError(503, "BUILD_MISSING", "Build the application before starting this server")
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW)
  const stat = fstatSync(fd)
  if (!stat.isFile()) { closeSync(fd); throw new HttpError(404, "NOT_FOUND", "Not found") }
  res.writeHead(200, {
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
    "content-length": stat.size,
    "cache-control": relative(root, file).split(sep)[0] === "assets" ? "public, max-age=31536000, immutable" : "no-cache",
    "x-content-type-options": "nosniff",
  })
  if (req.method === "HEAD") { closeSync(fd); res.end(); return }
  const stream = createReadStream(file, { fd, autoClose: true })
  stream.on("error", () => res.destroy())
  res.on("close", () => stream.destroy())
  stream.pipe(res)
}
