import type { APIRequestContext, Page } from "@playwright/test"
import { expect, test } from "./browser-fixtures"
import { starfallContent } from "../tests/fixtures/starfall"
import { adminNav, axe, DESKTOP, noOverflow } from "./helpers"
import { ISOLATED_PAIRS } from "./ports"

/*
 * Achievement requirements are edited with a form that writes the
 * existing requirement JSON; deeper combinations stay JSON, unchanged.
 * Runs on its own pair, since it saves and publishes drafts.
 */

test.describe.configure({ mode: "serial" })

const ADMIN = `http://127.0.0.1:${ISOLATED_PAIRS.requirements + 1}`
const headers = { "x-trovekit-admin": "1" }
const ORIGINAL = starfallContent().pack.achievements
const draft = async (request: APIRequestContext) => (await (await request.get(`${ADMIN}/admin-api/drafts/starfall`, { headers })).json()).content.pack.achievements as typeof ORIGINAL

async function openAchievement(page: Page, name: string) {
  await adminNav(page, "Achievements")
  await page.getByRole("button", { name: new RegExp(`^${name}`) }).click()
  const sheet = page.getByRole("dialog")
  await expect(sheet.getByRole("region", { name: "Requirement" })).toBeVisible()
  return sheet
}
const reading = (page: Page) => page.getByRole("dialog").locator("[data-requirement-reading]")
async function choose(page: Page, label: string, option: string) {
  await page.getByRole("dialog").getByRole("combobox", { name: label, exact: true }).click()
  await page.getByRole("option", { name: option, exact: true }).click()
}
async function close(page: Page) {
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
}
async function save(page: Page) {
  await page.getByRole("button", { name: "Save draft" }).click()
  await expect(page.getByText("Unsaved changes")).toHaveCount(0)
}

test("a relationship requirement is edited without JSON: size, count and the plain reading", async ({ page, request }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(ADMIN)
  const sheet = await openAchievement(page, "Bond of Two")
  await expect(sheet.getByRole("combobox", { name: "Requirement", exact: true })).toHaveText("Complete relationships")
  await expect(sheet.getByRole("combobox", { name: "Relationship size" })).toHaveText("Duo")
  await expect(sheet.getByLabel("Required count")).toHaveValue("1")
  await expect(reading(page)).toHaveText("Complete at least 1 duo relationship.")
  // The JSON stays tucked away until asked for.
  await expect(sheet.getByLabel("Requirement JSON")).toBeHidden()

  await choose(page, "Relationship size", "Trio")
  await expect(reading(page)).toHaveText("Complete at least 1 trio relationship.")
  await sheet.getByRole("button", { name: "Advanced: edit as JSON" }).click()
  expect(JSON.parse(await sheet.getByLabel("Requirement JSON").inputValue())).toEqual({ type: "relationships", min: 1, size: 3 })
  await choose(page, "Relationship size", "Any")
  await sheet.getByLabel("Required count").fill("2")
  await expect(reading(page)).toHaveText("Complete at least 2 relationships.")
  expect(JSON.parse(await sheet.getByLabel("Requirement JSON").inputValue())).toEqual({ type: "relationships", min: 2 })
  await axe(page, "requirement form")
  await sheet.screenshot({ path: "test-results/evidence/requirements-relationships-desktop.png" })

  // Out-of-range and impossible counts are explained, per the pack's own checks.
  await choose(page, "Relationship size", "Trio")
  await sheet.getByLabel("Required count").fill("5")
  await expect(sheet.getByRole("list", { name: "Requirement problems" })).toHaveText("Needs 5 relationships but the pack has 3.")
  await sheet.getByLabel("Required count").fill("11")
  await expect(sheet.getByRole("list", { name: "Requirement problems" })).toContainText("Required count must be a whole number from 1 to 10.")
  await sheet.getByLabel("Required count").fill("1")
  await expect(sheet.getByRole("list", { name: "Requirement problems" })).toHaveCount(0)
  await close(page)

  // Saved as the existing requirement JSON; nothing else about any achievement changed.
  await save(page)
  const saved = await draft(request)
  expect(saved[0]).toEqual({ ...ORIGINAL[0], requirement: { type: "relationships", min: 1, size: 3 } })
  expect(saved.slice(1)).toEqual(ORIGINAL.slice(1))
})

test("other conditions: groups, permanent resource, no card shared, and combinations", async ({ page, request }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(ADMIN)
  // Twin Bonds keeps its "no card shared" setting, and it can be switched off.
  let sheet = await openAchievement(page, "Twin Bonds")
  const disjoint = sheet.getByRole("switch", { name: "No card shared between relationships" })
  await expect(disjoint).toBeChecked()
  await expect(reading(page)).toHaveText("Complete at least 2 duo relationships, with no card shared between them.")
  await close(page)

  // Council of Masters: card count from one group; add a permanent resource and a group.
  sheet = await openAchievement(page, "Council of Masters")
  await expect(sheet.getByRole("combobox", { name: "Requirement", exact: true })).toHaveText("Acquire cards")
  const groups = sheet.getByRole("toolbar", { name: "Card groups" })
  await expect(groups.getByRole("button", { name: "Masters" })).toHaveAttribute("aria-pressed", "true")
  await groups.getByRole("button", { name: "Adepts" }).click()
  await choose(page, "Permanent resource", "Spark")
  await expect(reading(page)).toHaveText("Acquire at least 3 cards from Adepts or Masters with Spark as their permanent resource.")
  await close(page)

  // Grand Circle: all of two conditions. "One condition" waits until only one is left.
  sheet = await openAchievement(page, "Grand Circle")
  await expect(sheet.getByRole("combobox", { name: "Players need" })).toHaveText("All of these conditions")
  await expect(sheet.getByRole("group", { name: /^Condition \d$/ })).toHaveCount(2)
  await sheet.getByRole("combobox", { name: "Players need" }).click()
  await expect(page.getByRole("option", { name: "One condition" })).toHaveAttribute("aria-disabled", "true")
  await page.getByRole("option", { name: "Any one of these conditions" }).click()
  await expect(reading(page)).toContainText("Meet any one of these:")
  await sheet.getByRole("button", { name: "Add condition" }).click()
  const third = sheet.getByRole("group", { name: "Condition 3" })
  await third.getByRole("combobox", { name: "Requirement", exact: true }).click()
  await page.getByRole("option", { name: "Claim achievements", exact: true }).click()
  await expect(third.getByRole("combobox", { name: "Category" })).toHaveText("Bonds of Lore")
  await expect(reading(page)).toContainText("Have claimed at least 1 Bonds of Lore achievement.")
  await sheet.getByRole("button", { name: "Remove condition 1" }).click()
  await expect(sheet.getByRole("group", { name: /^Condition \d$/ })).toHaveCount(2)
  await sheet.screenshot({ path: "test-results/evidence/requirements-combination-desktop.png" })
  await close(page)

  await save(page)
  const saved = await draft(request)
  const byId = (id: string) => saved.find((a) => a.id === id)!
  const original = (id: string) => ORIGINAL.find((a) => a.id === id)!
  expect(byId("twin-bonds")).toEqual(original("twin-bonds"))
  expect(byId("council-of-masters")).toEqual({ ...original("council-of-masters"), requirement: { type: "cardCount", min: 3, groups: ["adepts", "masters"], permanentResource: "spark" } })
  expect(byId("grand-circle")).toEqual({
    ...original("grand-circle"),
    requirement: { type: "any", of: [{ type: "distinctPermanentResources", min: 3, groups: ["first-years", "adepts", "masters"] }, { type: "claimedCategory", category: "lore", min: 1 }] },
  })
})

test("a nested combination stays JSON, exactly as written, and publishes", async ({ page, request }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(ADMIN)
  const nested = { type: "all", of: [{ type: "cardCount", min: 4 }, { type: "any", of: [{ type: "relationships", min: 1, size: 3 }, { type: "distinctPermanentResources", min: 4 }] }] }
  let sheet = await openAchievement(page, "Full Hall")
  await sheet.getByRole("button", { name: "Advanced: edit as JSON" }).click()
  await sheet.getByLabel("Requirement JSON").fill(JSON.stringify(nested))
  // The form steps aside and says why; the reading still explains the rule.
  await expect(sheet.getByText(/combines conditions inside other combinations/)).toBeVisible()
  await expect(sheet.getByRole("combobox", { name: "Players need" })).toHaveCount(0)
  await expect(reading(page)).toContainText("Meet all of these:")
  await expect(reading(page)).toContainText("Any of: Complete at least 1 trio relationship.")
  // Unfinished JSON is explained and changes nothing.
  await sheet.getByLabel("Requirement JSON").fill('{"type": "all", "of": [')
  await expect(sheet.getByText("This is not complete JSON yet.")).toBeVisible()
  await sheet.getByLabel("Requirement JSON").fill(JSON.stringify(nested))
  await close(page)
  await save(page)
  expect((await draft(request)).find((a) => a.id === "full-hall")!.requirement).toEqual(nested)

  // Reopening shows it as JSON straight away, and publishing keeps it.
  sheet = await openAchievement(page, "Full Hall")
  await expect(sheet.getByLabel("Requirement JSON")).toBeVisible()
  expect(JSON.parse(await sheet.getByLabel("Requirement JSON").inputValue())).toEqual(nested)
  await close(page)
  await adminNav(page, "Versions")
  await page.getByRole("button", { name: "Publish version" }).click()
  await page.getByLabel("Note").fill("Requirement builder")
  await page.getByRole("button", { name: "Publish", exact: true }).click()
  await expect(page.getByText(/until you make this version the default/)).toBeVisible()
  const list = await (await request.get(`${ADMIN}/admin-api/content`, { headers })).json()
  const latest = list.versions.find((v: { note: string }) => v.note === "Requirement builder")
  const version = await (await request.get(`${ADMIN}/admin-api/versions/${latest.id}`, { headers })).json()
  expect(version.pack.achievements.find((a: { id: string }) => a.id === "full-hall").requirement).toEqual(nested)
})

for (const scheme of ["light", "dark"] as const)
  test(`the requirement form fits a phone and works from the keyboard (${scheme})`, async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme })).newPage()
    await page.goto(ADMIN)
    const sheet = await openAchievement(page, "The Triad")
    await expect(reading(page)).toHaveText("Complete at least 1 trio relationship.")
    // Keyboard: the size select opens and changes from the keyboard.
    const size = sheet.getByRole("combobox", { name: "Relationship size" })
    await size.focus()
    await page.keyboard.press("Enter")
    await page.getByRole("option", { name: "Duo", exact: true }).press("Enter")
    await expect(reading(page)).toHaveText("Complete at least 1 duo relationship.")
    await expect(size).toBeFocused()
    expect(await sheet.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await noOverflow(page)
    await axe(page, `requirement form phone ${scheme}`)
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))))
    await page.screenshot({ path: `test-results/evidence/requirements-phone-${scheme}.png` })
    // Escape from a field closes the sheet.
    await sheet.getByLabel("Required count").focus()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await page.context().close()
  })
