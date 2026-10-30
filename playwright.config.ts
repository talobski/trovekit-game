import { defineConfig, devices } from "@playwright/test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EMPTY_PAIRS, ISOLATED_PAIRS } from "./e2e/ports"

// Fresh per-run directories; never delete or seed an existing local library.
const runDir = mkdtempSync(join(tmpdir(), "trovekit-e2e-"))
const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'"
const seeded = quote(join(runDir, "seeded")), empty = quote(join(runDir, "empty"))
const isolated = (name: string) => quote(join(runDir, name))
// Browser suites intentionally create many rooms and play full games quickly.
const environment = "env -u PUBLIC_ORIGIN -u TRUSTED_PROXIES HOST=127.0.0.1 REQUESTS_PER_MINUTE=20000 ROOM_CREATES_PER_MINUTE=1000 MAX_ROOMS=500"

/*
 * End-to-end suite against the production build. Game server on 5280 and local
 * admin on 5281 share a throwaway data directory seeded with the Starfall test
 * fixture (Trovekit Game itself installs nothing). A second pair, 5282 and 5283,
 * runs on an empty data directory for the first-run experience.
 *
 * Public rooms only use the default version, so specs that make another pack
 * the default get their own seeded pair (ISOLATED_PAIRS) and never change what
 * the shared pair's rooms play.
 */
const pair = (name: string, port: number, seeded = true) => [
  {
    command: `${seeded ? `npx tsx e2e/seed.ts ${isolated(name)} && ` : ""}${environment} TROVEKIT_DATA=${isolated(name)} PORT=${port} BOT_DELAY_MS=250 npx tsx server/main.ts`,
    url: `http://localhost:${port}`,
    timeout: 180_000,
    reuseExistingServer: false,
  },
  {
    command: `env -u PUBLIC_ORIGIN -u TRUSTED_PROXIES TROVEKIT_DATA=${isolated(name)} ADMIN_PORT=${port + 1} npx tsx server/admin-main.ts`,
    url: `http://127.0.0.1:${port + 1}`,
    timeout: 180_000,
    reuseExistingServer: false,
  },
]
export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 2,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://localhost:5280", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `npx tsx e2e/seed.ts ${seeded} && npx vite build --logLevel warn && ${environment} TROVEKIT_DATA=${seeded} PORT=5280 BOT_DELAY_MS=250 npx tsx server/main.ts`,
      url: "http://localhost:5280",
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: `env -u PUBLIC_ORIGIN -u TRUSTED_PROXIES TROVEKIT_DATA=${seeded} ADMIN_PORT=5281 npx tsx server/admin-main.ts`,
      url: "http://127.0.0.1:5281",
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: `${environment} TROVEKIT_DATA=${empty} PORT=5282 npx tsx server/main.ts`,
      url: "http://localhost:5282",
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: `env -u PUBLIC_ORIGIN -u TRUSTED_PROXIES TROVEKIT_DATA=${empty} ADMIN_PORT=5283 npx tsx server/admin-main.ts`,
      url: "http://127.0.0.1:5283",
      timeout: 120_000,
      reuseExistingServer: false,
    },
    ...Object.entries(ISOLATED_PAIRS).flatMap(([name, port]) => pair(name, port)),
    ...Object.entries(EMPTY_PAIRS).flatMap(([name, port]) => pair(name, port, false)),
  ],
})
