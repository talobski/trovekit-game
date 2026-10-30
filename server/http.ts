import type { IncomingMessage, ServerResponse } from "node:http"
import type { Duplex } from "node:stream"

export class HttpError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** Only origin-form targets are supported, including behind a reverse proxy.
 * Decode once before routing; reject ambiguous separators and dot components.
 */
export function requestPath(req: IncomingMessage): string {
  const target = req.url ?? "/"
  try {
    if (target.length > 8192 || !target.startsWith("/") || target.startsWith("//") || /[\\\s#]/.test(target)) throw new Error()
    const raw = target.split("?", 1)[0]
    if (/%2f|%5c/i.test(raw)) throw new Error()
    const path = decodeURIComponent(raw)
    if (/[\x00-\x20\x7f\\%]/.test(path) || path.split("/").some(p => p === "." || p === "..")) throw new Error()
    // Validate query escapes too, without interpreting them as path components.
    decodeURIComponent(target.slice(raw.length))
    return path
  } catch {
    throw new HttpError(400, "BAD_TARGET", "Malformed request target")
  }
}

export function rejectUpgrade(socket: Duplex, status: number) {
  socket.on("error", () => socket.destroy())
  socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () => socket.destroy())
}

export async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  const type = req.headers["content-type"] ?? ""
  if (!type.startsWith("application/json")) throw new HttpError(415, "UNSUPPORTED_MEDIA", "Send JSON")
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw new HttpError(413, "TOO_LARGE", `Request is larger than ${Math.round(limit / 1024)} KB`)
    chunks.push(chunk as Buffer)
  }
  if (!size) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    throw new HttpError(400, "INVALID_JSON", "The file is not valid JSON")
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  if (res.destroyed || res.writableEnded) return
  const data = JSON.stringify(body)
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  })
  res.end(data)
}

export function bearer(req: IncomingMessage): string | undefined {
  const h = req.headers.authorization
  return h?.startsWith("Bearer ") ? h.slice(7) : undefined
}
