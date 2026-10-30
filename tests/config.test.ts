import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import { serverConfig, prepareDataDirectory } from "../server/config"
import { randomActionId } from "../src/lib/random-id"

const dirs: string[] = []
afterEach(() => { vi.unstubAllGlobals(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const root = () => { const dir = mkdtempSync(join(tmpdir(), "trovekit-config-")); dirs.push(dir); return dir }
it.each([
  ["PORT", "0"], ["PORT", "65536"], ["ADMIN_PORT", "abc"], ["BOT_DELAY_MS", "-1"], ["BOT_DELAY_MS", "NaN"],
  ["TROVEKIT_DATA", ""], ["TROVEKIT_DATA", "~/data"], ["MAX_ROOMS", "0"], ["WS_AUTH_TIMEOUT_MS", "1.5"],
  ["REQUESTS_PER_MINUTE", "Infinity"], ["MAX_CONNECTIONS", "-2"], ["HOST", "http://example.org"],
  ["PUBLIC_ORIGIN", "https://game.example/path"], ["PUBLIC_ORIGIN", "https://user:pass@game.example"], ["PUBLIC_ORIGIN", "null"],
  ["TRUSTED_PROXIES", "0.0.0.0/0"], ["TRUSTED_PROXIES", "localhost"], ["TRUSTED_PROXIES", ""],
])("rejects invalid %s=%s", (key, value) => {
  expect(() => serverConfig(root(), { [key]: value }, key === "ADMIN_PORT")).toThrow()
})
it("validates related timeouts and development HMR port bounds", () => {
  expect(() => serverConfig(root(), { REQUEST_TIMEOUT_MS: "10", HEADERS_TIMEOUT_MS: "20" })).toThrow(/headersTimeoutMs/)
  expect(() => serverConfig(root(), { PORT: "65530" }, false, true)).toThrow(/PORT/)
})
it("keeps admin on loopback regardless of HOST", () => {
  expect(serverConfig(root(), { HOST: "0.0.0.0" }, true).host).toBe("127.0.0.1")
})
it("reads the library from TROVEKIT_DATA and defaults to the project data directory", () => {
  const dir = root()
  expect(serverConfig(dir, { TROVEKIT_DATA: join(dir, "library") }).dataDir).toBe(join(dir, "library"))
  expect(serverConfig(dir, {}).dataDir).toBe(join(dir, "data"))
})
it("rejects unsafe or non-directory data locations", () => {
  const dir = root()
  for (const location of [dir, join(dir, "dist", "data"), join(dir, "public"), "/"]) expect(() => serverConfig(dir, { TROVEKIT_DATA: location })).toThrow()
  writeFileSync(join(dir, "file"), "x")
  expect(() => serverConfig(dir, { TROVEKIT_DATA: join(dir, "file") })).toThrow(/directory/)
})
it("prepares an isolated persistent directory and parses proxy configuration", () => {
  const dir = root(), data = join(dir, "library")
  const config = serverConfig(dir, { TROVEKIT_DATA: data, PUBLIC_ORIGIN: "https://game.example", TRUSTED_PROXIES: "127.0.0.1, ::1", MAX_ROOMS: "25" })
  expect(config.limits.maxRooms).toBe(25)
  expect(config.trustedProxies).toEqual(["127.0.0.1", "::1"])
  expect(() => prepareDataDirectory(config.dataDir)).not.toThrow()
})
it("rejects data paths through symlinked public directories, including nonexistent leaves", () => {
  const dir = root(), outside = root()
  mkdirSync(join(outside, "built"))
  symlinkSync(join(outside, "built"), join(dir, "dist"))
  for (const location of [join(dir, "dist", "new-data"), join(outside, "built", "new-data")]) {
    expect(() => serverConfig(dir, { TROVEKIT_DATA: location })).toThrow(/dedicated directory/)
  }
  symlinkSync("/", join(dir, "root-link"))
  expect(() => serverConfig(dir, { TROVEKIT_DATA: join(dir, "root-link") })).toThrow(/dedicated directory/)
})
it("generates UUID v4 action IDs without secure-context randomUUID", () => {
  const getRandomValues = crypto.getRandomValues.bind(crypto)
  vi.stubGlobal("crypto", { getRandomValues })
  const ids = Array.from({ length: 100 }, randomActionId)
  expect(new Set(ids).size).toBe(100)
  for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})
