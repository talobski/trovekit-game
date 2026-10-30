import { expect, it } from "vitest"
import { blankPack } from "../content"
import { contentIssues } from "../src/shared/content"
import { explainIssue, publishingStatus } from "../src/admin/validation"
import { starfallContent } from "./fixtures/starfall"

it("treats empty cards as draft progress without hiding genuine errors", () => {
  const content = blankPack("test", "Test")
  const issues = contentIssues(content)
  expect(publishingStatus(content, issues)).toBe("Draft: add cards to publish")
  expect(explainIssue(issues[0], content)).toMatchObject({ section: "cards", action: expect.stringContaining("You can save your draft now") })
  content.pack.name = ""
  expect(publishingStatus(content, contentIssues(content))).toBe("1 issue to fix before publishing")
  expect(explainIssue(contentIssues(content)[0], content).action).toBe("Enter a name.")
})
it("keeps readiness tied to authoritative validation and gives actionable card errors", () => {
  const content = starfallContent()
  expect(publishingStatus(content, contentIssues(content))).toBe("Ready to publish")
  content.pack.cards[0].points = 99
  const issues = contentIssues(content)
  expect(publishingStatus(content, issues)).toContain("fix before publishing")
  expect(explainIssue(issues[0], content)).toMatchObject({ section: "cards", title: expect.stringContaining(content.pack.cards[0].name), action: "Set points to 10 or less." })
  expect(explainIssue({ path: "pack.cards.0.group", message: 'Unknown card group "nope"' }, content).action).toContain("Choose a group from Card groups in Cards")
})
