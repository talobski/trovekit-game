/** Refresh distribution notices from the installed, lockfile-matched dependencies. */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dirname, "..")
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")) as { packages: Record<string, { version?: string }> }
const extra: Record<string, string> = {
  "react-remove-scroll-bar": "licenses/upstream/react-remove-scroll-bar.txt",
  "std-env": "licenses/upstream/std-env.txt",
  "victory-vendor": "licenses/upstream/victory.txt",
}
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim()
const parts = ["Third-party notices for Trovekit\n\nThese licenses cover their respective components, not Trovekit as a whole.\nGenerated from installed lockfile-matched packages; includes development tools.\nNative binaries are not part of the source/browser release. See docs/LICENSING.md.\n\n=== Copied/adapted shadcn/ui components: src/components/ui/ ===\n\n" + read("licenses/upstream/shadcn-ui.txt")]
const excluded: string[] = []
const missing: string[] = []
let count = 0
function notices(dir: string): string[] {
  return readdirSync(join(root, dir)).sort().flatMap(name => {
    if (name === "node_modules" || name === ".git") return []
    const path = join(dir, name)
    if (statSync(join(root, path)).isDirectory()) return notices(path)
    return /^(licen[sc]e|notice|copying)([.-]|$)/i.test(name) ? [path] : []
  })
}
for (const [path, info] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
  if (!path || !existsSync(join(root, path, "package.json"))) continue
  const pkg = JSON.parse(read(`${path}/package.json`)) as { name: string; version: string; license?: string }
  if (pkg.version !== info.version) throw new Error(`Lockfile mismatch: ${path}`)
  const files = notices(path)
  const supplement = extra[pkg.name]
    ?? (pkg.name.startsWith("@esbuild/") ? "node_modules/esbuild/LICENSE.md" : undefined)
    ?? (pkg.name.startsWith("@rolldown/binding-") ? "node_modules/rolldown/LICENSE" : undefined)
  if (supplement) files.push(supplement)
  if (!files.length) {
    if (pkg.name.startsWith("@img/sharp-libvips-")) { excluded.push(`${pkg.name}@${pkg.version}: separately installed native library, not redistributed here`); continue }
    missing.push(`${pkg.name}@${pkg.version}`); continue
  }
  count++
  parts.push(`=== ${pkg.name}@${pkg.version} (${pkg.license ?? "see license text"}) ===\n\n` + files.map(f => `${f}\n\n${read(f)}`).join("\n\n"))
}
if (missing.length) throw new Error(`Missing notice texts; review before distribution: ${missing.join(", ")}`)
parts.push("=== Excluded native binaries ===\n\n" + excluded.join("\n"))
writeFileSync(join(root, "public/third-party-notices.txt"), parts.join("\n\n") + "\n")
console.log(`Collected notices for ${count} installed packages plus shadcn/ui. Review target-platform native licensing separately.`)
