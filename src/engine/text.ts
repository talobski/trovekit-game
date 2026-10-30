import type { Labels, Pack } from "./schema"

/** Defaults for optional labels, so packs and saved snapshots without them read generically. */
export const LABEL_DEFAULTS = { card: "Card", cards: "Cards" } as const

/** A label with its default applied (optional labels only differ when absent). */
export function labelOf(pack: Pack, key: keyof Labels): string {
  return pack.labels[key] ?? LABEL_DEFAULTS[key as keyof typeof LABEL_DEFAULTS]
}

/**
 * Placeholders in pack text, resolved against stable ids at display time so
 * renamed labels follow automatically:
 *   {group:<card group id>}  {kind:<resource kind id>}  {label:<labels key>}
 * Text without placeholders is returned unchanged.
 */
const PLACEHOLDER = /\{(group|kind|label):([^{}\s]+)\}/g

function lookup(pack: Pack, type: string, ref: string): string | undefined {
  if (type === "group") return pack.cardGroups.find((g) => g.id === ref)?.label
  if (type === "kind") return pack.resourceKinds.find((k) => k.id === ref)?.label
  if (!Object.hasOwn(pack.labels, ref) && !Object.hasOwn(LABEL_DEFAULTS, ref)) return undefined
  // A label may itself name other labels (e.g. collect: "Collect {label:resources}").
  // One level only, so labels that name each other cannot loop.
  return labelOf(pack, ref as keyof Labels).replace(new RegExp(PLACEHOLDER.source, "g"), (whole, t: string, r: string) =>
    t === "label" && (Object.hasOwn(pack.labels, r) || Object.hasOwn(LABEL_DEFAULTS, r)) ? labelOf(pack, r as keyof Labels) : whole
  )
}

/** Resolve every known placeholder; unknown ones are left as written. */
export function resolvePlaceholders(pack: Pack, text: string): string {
  return text.replace(PLACEHOLDER, (whole, type: string, ref: string) => lookup(pack, type, ref) ?? whole)
}

/** One message per unknown reference or stray brace; empty when the text is valid. */
export function placeholderProblems(pack: Pack, text: string): string[] {
  const problems: string[] = []
  for (const [whole, type, ref] of text.matchAll(PLACEHOLDER)) {
    if (lookup(pack, type, ref) !== undefined) continue
    const what = type === "group" ? "card group" : type === "kind" ? "resource kind" : "label"
    problems.push(`Unknown ${what} "${ref}" in ${whole}`)
  }
  if (/[{}]/.test(text.replace(PLACEHOLDER, ""))) problems.push("Braces are only for {group:id}, {kind:id} and {label:key} placeholders")
  return problems
}
