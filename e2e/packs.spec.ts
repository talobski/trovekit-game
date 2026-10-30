import { test, expect } from "./browser-fixtures"
import { starfallContent } from "../tests/fixtures/starfall"
import { adminNav, axe, noOverflow } from "./helpers"
import { ISOLATED_PAIRS } from "./ports"

// Making a pack the default changes what every new room plays, so this runs on its own server pair.
const GAME = `http://localhost:${ISOLATED_PAIRS.packs}`
const ADMIN = `http://127.0.0.1:${ISOLATED_PAIRS.packs + 1}`

for (const width of [390, 1280]) test(`independent pack workflow at ${width}`, async ({ page, browser }) => {
  await page.setViewportSize({ width, height: 900 })
  await page.goto(ADMIN)
  await adminNav(page, "Settings")
  await page.getByLabel("New pack name").fill(`Fiction ${width}`)
  await page.getByRole("button", { name: "Duplicate pack" }).click()
  await expect(page.getByText(`Created Fiction ${width} with the ID fiction-${width}`, { exact: true })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`#/packs/fiction-${width}$`))
  await adminNav(page, "Cards")
  const cards = starfallContent().pack.cards.map((c, i) => ({ ...c, name: `Fiction ${width} Hero ${i}`, shortName: `Hero ${i}` }))
  await page.getByLabel("Import cards file").setInputFiles({ name: "cards.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(cards)) })
  await expect(page.getByRole("heading", { name: "Review import", exact: true })).toBeVisible()
  await expect(page.getByText(/66 existing IDs replaced/)).toBeVisible()
  await expect(page.getByRole("button", { name: "Apply to editor" })).toBeDisabled()
  await page.getByRole("switch", { name: "Apply this batch and replace 66 existing cards in my draft" }).click()
  await noOverflow(page)
  await axe(page, "pack review")
  await page.getByRole("button", { name: "Apply to editor" }).click()
  await page.getByRole("button", { name: "Publish version" }).click()
  await page.getByRole("button", { name: "Publish", exact: true }).click()
  // Published but not the default: players are not offered it, and there is no pack choice on Home.
  expect((await (await page.request.get(`${GAME}/api/packs`)).json()).map((p: { name: string }) => p.name)).not.toContain(`Fiction ${width}`)
  await page.getByRole("button", { name: "Make default" }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  const gameContext = await browser.newContext({ viewport: { width, height: 900 } })
  const game = await gameContext.newPage()
  await game.goto(GAME)
  await expect(game.getByRole("combobox")).toHaveCount(0)
  await game.getByLabel("Your name", { exact: true }).fill("Host")
  await game.getByRole("button", { name: "Create room", exact: true }).click()
  await game.getByRole("button", { name: "Add bot", exact: true }).click()
  await game.getByRole("button", { name: /Start game/ }).click()
  await expect(game.locator(`button[aria-label*="Fiction ${width} Hero"]`).first()).toBeVisible()
  await noOverflow(game)
  await axe(game, "fiction board")
  await game.screenshot({ path: `test-results/evidence/packs-${width}-board.png`, fullPage: true })
  await gameContext.close()
})

test("full JSON import requires review and blocks invalid rules", async ({ page }) => {
  await page.goto("http://127.0.0.1:5281")
  const { pack, rules } = starfallContent()
  const candidate = { pack: { ...pack, id: "imported-theme", name: "Imported theme" }, rules }
  await page.getByLabel("Import JSON file").setInputFiles({ name: "pack.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(candidate)) })
  await expect(page.getByRole("heading", { name: "Review import" })).toBeVisible()
  await page.getByRole("button", { name: "View technical details" }).click()
  const json = page.getByLabel("Pack JSON")
  await json.fill(JSON.stringify({ ...candidate, rules: { ...candidate.rules, targetPoints: 0 } }))
  await expect(page.getByRole("button", { name: "Import", exact: true })).toBeDisabled()
  await expect(page.getByText("Fix these fields in the technical details before importing.")).toBeVisible()
  await json.fill(JSON.stringify(candidate))
  await page.getByRole("button", { name: "Import", exact: true }).click()
  await adminNav(page, "Settings")
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Imported theme")
})
