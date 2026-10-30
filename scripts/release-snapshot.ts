/**
 * Check, and optionally export, the public source snapshot of a commit.
 *
 *   npm run release:check                         check HEAD against the allowlist
 *   npm run release:snapshot -- <out-dir> [ref]   also write the archive and its manifest
 *
 * Only files tracked in the commit are considered, so ignored data, builds and
 * local notes can never be included. Each one must be on scripts/release-allowlist.txt,
 * must not be a binary or oversized file, and must not contain private paths,
 * private-tracker references or credentials. The archive comes from `git archive`,
 * so the same commit always produces the same bytes.
 */
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const root = join(import.meta.dirname, "..")
const NAME = "trovekit-game"
const MAX_BYTES = 1024 * 1024
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|zip|tar|gz|tgz|pdf|woff2?|ttf|pem|key|crt|p12|pfx|db|sqlite3?)$/i
const FORBIDDEN: [string, RegExp][] = [
  ["a private home directory", /\/Users\/[A-Za-z]|\/home\/[a-z][\w.-]*\//],
  ["a local checkout path", /~\/dev\//],
  ["a private-tracker reference", /\bPROJ-\d+\b/],
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["an access token", /\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}|\bsk-[A-Za-z0-9_-]{20,}|\bAKIA[0-9A-Z]{16}\b|\bxox[abprs]-[A-Za-z0-9-]{10,}/],
]

function git(args: string[]): Buffer {
  const result = spawnSync("git", args, { cwd: root, maxBuffer: 256 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.toString().trim()}`)
  return result.stdout
}

const [outArg, ref = "HEAD"] = process.argv.slice(2)
const commit = git(["rev-parse", "--verify", `${ref}^{commit}`]).toString().trim()
const allow = readFileSync(join(root, "scripts/release-allowlist.txt"), "utf8")
  .split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"))
const allowed = (path: string) => allow.some((entry) => entry.endsWith("/") ? path.startsWith(entry) : path === entry)

const files = git(["ls-tree", "-r", "-z", "--name-only", commit]).toString().split("\0").filter(Boolean).sort()
const problems: string[] = []
const manifest: string[] = []
for (const path of files) {
  if (!allowed(path)) { problems.push(`${path}: not on the release allowlist`); continue }
  if (BINARY.test(path)) { problems.push(`${path}: binary files need an explicit review`); continue }
  const bytes = git(["cat-file", "blob", `${commit}:${path}`])
  if (bytes.length > MAX_BYTES) problems.push(`${path}: larger than 1 MB`)
  const text = bytes.toString("utf8")
  for (const [what, pattern] of FORBIDDEN) {
    const line = text.split("\n").findIndex((l) => pattern.test(l))
    if (line >= 0) problems.push(`${path}:${line + 1}: contains ${what}`)
  }
  manifest.push(`${createHash("sha256").update(bytes).digest("hex")}  ${path}`)
}

if (problems.length) {
  console.error(`Release check failed for ${commit}:\n  ${problems.join("\n  ")}`)
  process.exit(1)
}
console.log(`Release check passed: ${files.length} files at ${commit}.`)

if (outArg) {
  const out = resolve(outArg)
  if (!relative(root, out).startsWith("..")) throw new Error("Write the snapshot outside the repository")
  mkdirSync(out, { recursive: true })
  const base = join(out, `${NAME}-${commit.slice(0, 12)}`)
  git(["archive", "--format=tar", `--prefix=${NAME}/`, "-o", `${base}.tar`, commit, "--", ...files])
  const archive = createHash("sha256").update(readFileSync(`${base}.tar`)).digest("hex")
  writeFileSync(`${base}.manifest.txt`, `# ${NAME} source snapshot\n# commit ${commit}\n# ${files.length} files\n# archive sha256 ${archive}\n${manifest.join("\n")}\n`)
  console.log(`Wrote ${base}.tar (sha256 ${archive}) and ${base}.manifest.txt`)
}
