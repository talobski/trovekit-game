import { contentIssues, draftDiagnostics, type Content } from "@/shared/content"
import type { Issue } from "@/engine/validate"
import { issueSection } from "./validation"
import type { Section } from "./routes"

/*
 * The new-pack checklist on Overview. Every step is derived from the pack
 * itself, never from which pages were visited.
 *
 * validateContent (the publishing authority, also run by the server) stops at
 * the first failing stage: while the shape is invalid, for example because a
 * draft has no cards yet, it never checks references or ranges. So a step
 * that found no problems there is not necessarily complete. These diagnostics
 * use draftDiagnostics (cards optional, semantic checks run separately), and a
 * step whose checks could not run is "pending", never "done".
 */

export type StepState = "done" | "todo" | "attention" | "pending"

export interface SetupStep {
  id: "resources" | "groups" | "cards" | "rules" | "publish"
  title: string
  state: StepState
  detail: string
  links: { section: Section; label: string }[]
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const problems = (issues: Issue[]) => `${count(issues.length, "problem")} to fix`

export function setupSteps(content: Content): SetupStep[] {
  const { pack } = content
  // Without a valid shape the semantic checks cannot run, so steps with no shape problems stay pending.
  const { checked, issues: found } = draftDiagnostics(content)

  const groupIndex = (path: string) => Number(path.match(/^pack\.cardGroups\.(\d+)\.deckSize/)?.[1] ?? -1)
  const emptyGroups = pack.cardGroups.filter((g) => !pack.cards.some((c) => c.group === g.id))
  const isEmptyGroup = (i: Issue) => {
    const g = pack.cardGroups[groupIndex(i.path)]
    return !!g && emptyGroups.includes(g)
  }
  const area = (test: (i: Issue) => boolean) => found.filter(test)
  const resourceIssues = area((i) => issueSection(i.path) === "resources")
  const groupIssues = area((i) => i.path.startsWith("pack.cardGroups") && groupIndex(i.path) < 0)
  const cardIssues = area((i) => i.path.startsWith("pack.cards") || (groupIndex(i.path) >= 0 && !isEmptyGroup(i)))
  const contentRuleIssues = area((i) => ["rules", "achievements", "relationships"].includes(issueSection(i.path)))

  const settled = (issues: Issue[], done: string): Pick<SetupStep, "state" | "detail"> =>
    issues.length ? { state: "attention", detail: problems(issues) }
      : checked ? { state: "done", detail: done }
        : { state: "pending", detail: "Checked once the problems in other steps are fixed." }

  const cardsComplete = pack.cards.length > 0 && !emptyGroups.length
  const cards: Pick<SetupStep, "state" | "detail"> = cardIssues.length ? { state: "attention", detail: problems(cardIssues) }
    : !pack.cards.length ? { state: "todo", detail: "No cards yet. Import a batch or add them one at a time." }
      : emptyGroups.length ? { state: "todo", detail: `${count(pack.cards.length, "card")}. No cards in ${emptyGroups.map((g) => g.label).join(", ")} yet.` }
        : settled([], count(pack.cards.length, "card"))

  // Achievements that need more cards than exist cannot be judged until every group has cards.
  const waiting = cardsComplete ? [] : contentRuleIssues.filter((i) => /^Needs /.test(i.message))
  const ruleIssues = contentRuleIssues.filter((i) => !waiting.includes(i))
  const rulesStep: Pick<SetupStep, "state" | "detail"> = !ruleIssues.length && waiting.length
    ? { state: "pending", detail: "Achievements are checked against your cards once every group has some." }
    : settled(ruleIssues, `${count(pack.achievements.length, "achievement")} and ${count(pack.relationships.length, "relationship")}, no problems found.`)

  // Publishing readiness is exactly what publishing checks.
  const blocking = contentIssues(content)
  const publish: Pick<SetupStep, "state" | "detail"> = !blocking.length ? { state: "todo", detail: "Ready to publish." }
    : !cardsComplete && blocking.every((i) => i.path === "pack.cards" || isEmptyGroup(i) || /^Needs /.test(i.message))
      ? { state: "pending", detail: "Add cards to every group before publishing." }
      : { state: "attention", detail: `${count(blocking.length, "issue")} to fix before publishing.` }

  return [
    { id: "resources", title: "Configure resources", links: [{ section: "resources", label: "Resources" }], ...settled(resourceIssues, pack.resourceKinds.map((k) => k.label).join(", ")) },
    { id: "groups", title: "Configure card groups", links: [{ section: "cards", label: "Card groups" }], ...settled(groupIssues, `${count(pack.cardGroups.length, "group")}: ${pack.cardGroups.map((g) => g.label).join(", ")}`) },
    { id: "cards", title: "Add cards", links: [{ section: "cards", label: "Cards" }], ...cards },
    { id: "rules", title: "Review rules and achievements", links: [{ section: "rules", label: "Rules" }, { section: "achievements", label: "Achievements" }], ...rulesStep },
    { id: "publish", title: "Review and publish", links: [{ section: "preview", label: "Preview" }], ...publish },
  ]
}
