import type { Pack, Rules } from "../src/engine/schema.ts"
import blank from "./templates/blank-pack.json" with { type: "json" }
import rules from "./rules/default.json" with { type: "json" }

/*
 * Generic starting points for new content packs. Nothing here is installed:
 * a fresh Trovekit Game has an empty library until a pack is created or imported.
 */

/** Default rules for new packs. Validated by tests/content.test.ts. */
export const defaultRules = rules as unknown as Rules

/** The blank pack template: generic labels, five resources, three tiers, no cards yet. */
export const blankPackTemplate = blank as unknown as Pack

export function blankPack(id: string, name: string) {
  const pack = structuredClone(blankPackTemplate)
  pack.id = id; pack.name = name; pack.labels.game = name.slice(0, 32)
  return { pack, rules: structuredClone(defaultRules) }
}
