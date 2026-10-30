import type { Issue } from "@/engine/validate"
import type { Content } from "@/shared/content"
import { SECTION_LABEL, type Section } from "./routes"

/** The workspace section where an issue's field is edited. */
export function issueSection(path: string): Section {
  const [root, area] = path.split(".")
  if (root === "rules") return "rules"
  if (root !== "pack") return "settings"
  if (area === "cards" || area === "cardGroups") return "cards"
  if (area === "resourceKinds" || area === "resourceArt") return "resources"
  if (area === "achievements" || area === "achievementCategories") return "achievements"
  if (area === "relationships") return "relationships"
  return "settings"
}

export function isMissingCards(issue: Issue, content?: Content) {
  return content?.pack.cards.length === 0 && issue.path === "pack.cards" && /Too small/.test(issue.message)
}

export function publishingStatus(content: Content, issues: Issue[]) {
  const errors = issues.filter(i => !isMissingCards(i, content))
  return errors.length ? `${errors.length} ${errors.length === 1 ? "issue" : "issues"} to fix before publishing`
    : issues.length ? "Draft: add cards to publish" : "Ready to publish"
}

/** Author-facing copy; the original server/schema issue stays available in technical details. */
export function explainIssue(issue: Issue, content?: Content): { title: string; action: string; section: Section } {
  const parts = issue.path.split(".")
  const area = parts[0] === "rules" ? "rules" : parts[1]
  const section = issueSection(issue.path)
  const field = parts.at(-1) ?? "value"
  const label = field.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()
  let title = SECTION_LABEL[section]
  const row = Number(parts[2])
  if (Number.isInteger(row) && row >= 0) {
    const item = area === "cards" ? content?.pack.cards[row] : area === "cardGroups" ? content?.pack.cardGroups[row] : area === "resourceKinds" ? content?.pack.resourceKinds[row] : area === "achievements" ? content?.pack.achievements[row] : area === "relationships" ? content?.pack.relationships[row] : undefined
    title = `${area === "cards" ? "Card" : area === "cardGroups" ? "Group" : area === "resourceKinds" ? "Resource" : title} ${row + 1}${item ? `: ${"name" in item ? item.name : item.label}` : ""}`
  }
  const m = issue.message
  let action = m
  if (issue.path === "JSON") { title = "Import format"; action = "Correct the JSON syntax in Edit JSON and ID mappings. Check quotes, commas and brackets." }
  else if (isMissingCards(issue, content)) action = "Add at least one card before publishing this pack. You can save your draft now."
  else if (m === "Required") action = `Enter ${label === "name" ? "a name" : `a value for ${label}`}.`
  else if (/Too small: expected number to be >=/.test(m)) action = `Set ${label} to at least ${m.split(">=")[1]}.`
  else if (/Too big: expected number to be <=/.test(m)) action = `Set ${label} to ${m.split("<=")[1]} or less.`
  else if (/Too small: expected array/.test(m)) action = `Add at least ${m.match(/>=(\d+)/)?.[1] ?? "one"} ${label} before publishing.`
  else if (/Too big: expected array/.test(m)) action = `Reduce ${label} to ${m.match(/<=(\d+)/)?.[1] ?? "the allowed number of"} items.`
  else if (/Invalid input: expected (number|int)/.test(m) || /expected int/.test(m)) action = `Enter a whole number for ${label}.`
  else if (/Invalid input|Invalid option/.test(m)) action = `Choose or enter a valid ${label}.`
  else if (/Markup characters/.test(m)) action = `Remove < and > from ${label}. Use plain text.`
  else if (/Unknown card group/.test(m)) action = `${m}. Choose a group from Card groups in Cards.`
  else if (/Unknown resource kind/.test(m)) action = `${m}. Use a resource ID from Resources.`
  else if (/Total cost .* outside/.test(m)) action = `${m}. Adjust this card's costs to fit its group.`
  else if (/Points .* outside/.test(m)) action = `${m}. Adjust this card's points to fit its group.`
  else if (/deckSize/.test(m)) action = "Add cards to this group so its deck is not empty. Deck size follows the cards you add."
  else if (/Needs .* but/.test(m)) action = `${m}. Add matching content or lower the achievement requirement.`
  else if (/Unknown card /.test(m)) action = `${m}. Select an existing card for this relationship.`
  else if (/already appears|Duplicate|listed twice/.test(m)) action = `${m}. Give each card its own ID and tiered name; select each relationship card only once.`
  else if (/Unrecognized key/.test(m)) action = `${m}. Remove unsupported fields from the import.`
  else if (/min must not exceed max/.test(m)) action = "Set the minimum no higher than the maximum."
  return { title, action, section }
}
