import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const root = join(import.meta.dirname, "..")
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : []
  })
const source = [...files(join(root, "src")), ...files(join(root, "server"))]

describe("content validation has one home", () => {
  it("the servers never import admin client code", () => {
    const offenders = files(join(root, "server")).filter((f) => /from "\.\.\/src\/admin\//.test(readFileSync(f, "utf8")))
    expect(offenders.map((f) => relative(root, f))).toEqual([])
  })

  it("only src/shared/content.ts combines pack and rules validation", () => {
    // validateRules is the second half of every full content check; outside the engine it may only be called here.
    const callers = source.filter((f) => !f.includes(`${join("src", "engine")}`) && /\bvalidateRules\(/.test(readFileSync(f, "utf8")))
    expect(callers.map((f) => relative(root, f))).toEqual([join("src", "shared", "content.ts")])
  })

  it("Content and PackSummary are declared once", () => {
    const declares = (name: string) => source.filter((f) => new RegExp(`(interface|type) ${name}\\b\\s*[={]`).test(readFileSync(f, "utf8")))
    expect(declares("Content").map((f) => relative(root, f))).toEqual([join("src", "shared", "content.ts")])
    expect(declares("PackSummary").map((f) => relative(root, f))).toEqual([join("src", "shared", "content.ts")])
  })
})

describe("a generic engine with nothing installed", () => {
  it("bundles no content pack and no artwork: only generic rules and the blank template", () => {
    expect(readdirSync(join(root, "content")).sort()).toEqual(["index.ts", "rules", "templates"])
    expect(readdirSync(join(root, "content", "templates"))).toEqual(["blank-pack.json"])
    expect(readdirSync(join(root, "public")).sort()).toEqual(["favicon.svg", "third-party-notices.txt"])
  })

  it("shared code carries no theme vocabulary and never branches on a pack id", () => {
    const themed = source.filter((f) => /basketball|prospect|franchise|rebounder|superstar|recruit|highflyer|playmaker/i.test(readFileSync(f, "utf8")))
    expect(themed.map((f) => relative(root, f))).toEqual([])
    const byId = source.filter((f) => /pack\.id\s*===\s*["']/.test(readFileSync(f, "utf8")))
    expect(byId.map((f) => relative(root, f))).toEqual([])
  })
})
