import { LABEL_DEFAULTS, labelOf, resolvePlaceholders, type Pack } from "@/engine/client"

/** The pack's noun for its collectible cards, in running text ("star", "stars"; default "card"). */
export const noun = (pack: Pack, key: "card" | "cards") => labelOf(pack, key).toLowerCase()

/** "a star", "an artifact": a plain English article for a pack noun. */
export const withArticle = (word: string) => `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`

/**
 * The pack as players see it: optional labels get their generic defaults, and
 * placeholders in labels and achievement descriptions resolve to the pack's
 * current words. Display only. Never persist this projection or use it as the
 * content hash. No pack is treated specially.
 */
export function presentPack(pack: Pack): Pack {
  const labels = { ...LABEL_DEFAULTS, ...pack.labels }
  const withDefaults = { ...pack, labels }
  labels.collect = resolvePlaceholders(withDefaults, pack.labels.collect)
  labels.collected = resolvePlaceholders(withDefaults, pack.labels.collected)
  return {
    ...withDefaults,
    achievements: pack.achievements.map((a) => ({ ...a, description: resolvePlaceholders(withDefaults, a.description) })),
  }
}

/**
 * Past-tense verbs for the activity feed and turn toasts, from a presented pack:
 * the pack's own past forms (labels.collected, reserved and acquired).
 */
export function pastVerbs(pack: Pack): { collect: string; reserve: string; acquire: string } {
  const { labels } = pack
  return { collect: labels.collected, reserve: labels.reserved, acquire: labels.acquired }
}

/** Translate actionable server errors at the UI boundary, keeping API text stable. */
export function actionError(pack: Pack, error: { code: string; message: string }): string {
  if (error.code === "CANNOT_AFFORD") return `Not enough ${pack.labels.resources.toLowerCase()} to ${pack.labels.acquire.toLowerCase()} this ${noun(pack, "card")}`
  return error.message
}
