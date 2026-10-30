import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

/*
 * Select policy:
 *   - shadcn Select for standard dropdowns
 *   - the Combobox pattern (src/components/combobox.tsx) for long or searchable lists
 *   - no NativeSelect or raw <select> without a specific technical reason (none today)
 */

const src = join(import.meta.dirname, "../src")
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : []
  })

describe("UI conventions", () => {
  it("uses no NativeSelect or raw <select>", () => {
    expect(existsSync(join(src, "components/ui/native-select.tsx"))).toBe(false)
    const offenders = files(src).filter((f) => /native-select|<select[\s>]/.test(readFileSync(f, "utf8")))
    expect(offenders.map((f) => relative(src, f))).toEqual([])
  })

  it("uses shadcn Collapsible rather than native <details> disclosure", () => {
    const offenders = files(src).filter((f) => /<details[\s>]/.test(readFileSync(f, "utf8")))
    expect(offenders.map((f) => relative(src, f))).toEqual([])
  })

  it("uses only font utilities the theme defines (type-heading, not font-heading)", () => {
    const offenders = files(src).filter((f) => /["'\s]font-heading["'\s]/.test(readFileSync(f, "utf8")))
    expect(offenders.map((f) => relative(src, f))).toEqual([])
  })

  it("long lists use the Combobox: relationship player pickers", () => {
    const editor = readFileSync(join(src, "admin/sections/relationships.tsx"), "utf8")
    expect(editor).toContain("<ComboboxField")
    expect(editor).not.toContain("<SelectField")
  })

  it("admin form fields compose shadcn Field, Select and the Combobox", () => {
    const fields = readFileSync(join(src, "admin/fields.tsx"), "utf8")
    expect(fields).toContain('from "@/components/ui/field"')
    expect(fields).toContain('from "@/components/ui/select"')
    expect(fields).toContain('from "@/components/combobox"')
  })
})
