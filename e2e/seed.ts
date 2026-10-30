/**
 * Seeds an e2e data directory with the Starfall fixture (artwork included),
 * published and active. Trovekit Game itself starts with an empty library; the
 * browser suite installs this explicitly before the servers start.
 *   npx tsx e2e/seed.ts <dataDir>
 */
import { ContentStore } from "../server/content-store.ts"
import { importBundle } from "../server/bundles.ts"
import { starfallBundle } from "../tests/fixtures/starfall.ts"

const dir = process.argv[2]
if (!dir) throw new Error("Usage: tsx e2e/seed.ts <dataDir>")
const { zip } = await starfallBundle()
const content = await importBundle(dir, zip)
const store = new ContentStore(dir)
const saved = store.publish(content, "e2e fixture")
if (!saved.ok || !store.activate(saved.version.id).ok) throw new Error(JSON.stringify(saved))
console.log(`Seeded ${dir} with ${content.pack.name} (${saved.version.id})`)
