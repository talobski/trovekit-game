import { readFileSync, writeFileSync } from "node:fs"
import { expect, test } from "./browser-fixtures"
import { adminNav, axe, noOverflow, openRoomUi } from "./helpers"

const ADMIN = process.env.TROVEKIT_ADMIN_URL ?? "http://127.0.0.1:5281"

test.describe.configure({ mode: "serial" })

test("the admin opens the active pack: three tiered groups, no unique group", async ({ page }) => {
  await page.goto(ADMIN)
  await adminNav(page, "Cards")
  await expect(page.getByRole("textbox", { name: "Label (tiered)" })).toHaveCount(3)
  await expect(page.getByRole("textbox", { name: "Label (unique)" })).toHaveCount(0)
  await expect(page.getByRole("textbox", { name: "Label (tiered)" }).nth(0)).toHaveValue("First Years")
  await expect(page.getByRole("textbox", { name: "Label (tiered)" }).nth(1)).toHaveValue("Adepts")
  await expect(page.getByRole("textbox", { name: "Label (tiered)" }).nth(2)).toHaveValue("Masters")

  await adminNav(page, "Rules")
  await expect(page.getByLabel("Unique cards per player")).toHaveCount(0)
  await expect(page.getByLabel("Face-up unique cards")).toHaveCount(0)

  await adminNav(page, "Cards")
  await page.getByRole("combobox", { name: "Filter by group" }).click()
  await expect(page.getByRole("option", { name: "Masters" })).toBeVisible()
  await page.keyboard.press("Escape")
})

test("admin edits rules and a card, saves a version, and new rooms use it", async ({ page, browser }) => {
  await page.goto(ADMIN)
  await adminNav(page, "Rules")
  await page.getByLabel("Target points").fill("18")
  await expect(page.getByText("Unsaved changes")).toBeVisible()

  await adminNav(page, "Cards")
  await page.getByRole("button", { name: /Aria Ashgrove/ }).click()
  await page.getByRole("dialog").getByLabel("Points", { exact: true }).fill("1")
  await page.keyboard.press("Escape")

  await adminNav(page, "Versions")
  await expect(page.getByText("targetPoints: 15 → 18")).toBeVisible()
  await expect(page.getByText(/points: 0 → 1/)).toBeVisible()

  await page.getByRole("button", { name: "Publish version" }).click()
  await page.getByLabel("Note").fill("Longer games")
  await page.getByRole("button", { name: "Publish", exact: true }).click()
  // Publishing alone leaves the default unchanged; Make default is the next step.
  await expect(page.getByText(/New rooms still use 1\.0\.0 until you make this version the default/)).toBeVisible()
  await page.getByRole("button", { name: "Make default" }).click()
  await expect(page.getByText(/New rooms now use/)).toBeVisible()
  await expect(page.locator("li", { hasText: "Longer games" }).getByText("Default")).toBeVisible()

  // A new room on the game server picks it up.
  const { seats } = await openRoomUi(browser, ["Ana", "Ben"])
  await expect(seats[0].page.getByText("First to 18")).toBeVisible()
})

test("invalid imports are blocked with clear errors; valid ones load; export round-trips", async ({ page }) => {
  await page.goto(ADMIN)
  await adminNav(page, "Settings")
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "Export JSON" }).click()
  const file = await (await download).path()
  const exported = JSON.parse(readFileSync(file, "utf8"))
  expect(exported.rules.targetPoints).toBe(18)

  const broken = structuredClone(exported)
  broken.pack.relationships[0].cardIds[0] = "nobody"
  broken.pack.cards[0].name = "<script>x</script>"
  const brokenPath = test.info().outputPath("broken.json")
  writeFileSync(brokenPath, JSON.stringify(broken))
  await page.getByLabel("Import JSON file").setInputFiles(brokenPath)
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading", { name: "Import blocked" })).toBeVisible()
  await expect(dialog.getByText("Remove < and > from name. Use plain text.")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("banner")).not.toContainText("Unsaved changes")

  const notJson = test.info().outputPath("bad.json")
  writeFileSync(notJson, "{ nope")
  await page.getByLabel("Import JSON file").setInputFiles(notJson)
  await expect(page.getByRole("dialog").getByText(/Not valid JSON/)).toBeVisible()
  await page.keyboard.press("Escape")

  const good = structuredClone(exported)
  good.rules.holdingCap = 9
  const goodPath = test.info().outputPath("good.json")
  writeFileSync(goodPath, JSON.stringify(good))
  await page.getByLabel("Import JSON file").setInputFiles(goodPath)
  await page.getByRole("button", { name: "Import", exact: true }).click()
  // The import reuses this pack's ID, so it asks before touching anything.
  await page.getByRole("dialog").getByRole("button", { name: "Update Starfall Academy" }).click()
  // Saved as the pack's draft straight away.
  await expect(page.getByText("Imported into Starfall Academy and saved it as a draft.")).toBeVisible()
  await expect(page.getByRole("banner")).toContainText("Starfall Academy · Draft")
  await expect(page.getByRole("banner")).not.toContainText("Unsaved changes")
  await adminNav(page, "Rules")
  await expect(page.getByLabel("Holding cap")).toHaveValue("9")
})

test("validation blocks saving bad edits; an earlier version can be loaded and made active again", async ({ page, browser }) => {
  await page.goto(ADMIN)
  await adminNav(page, "Relationships")
  await page.getByRole("button", { name: /Aria Ashgrove and Bram Ashgrove/ }).click()
  await page.getByLabel("Id").fill("Bad Id!")
  await page.keyboard.press("Escape")
  await expect(page.getByText("1 issue to fix before publishing")).toBeVisible()
  await expect(page.getByRole("button", { name: "Publish version" })).toBeDisabled()
  await page.getByRole("button", { name: "Review requirements" }).click()
  await expect(page.getByRole("list", { name: "Validation issues" })).toContainText("Use 1-48 lowercase letters")
  await page.getByRole("button", { name: "Technical details" }).click()
  await expect(page.getByText(/pack.relationships.0.id:/)).toBeVisible()

  // There is no built-in content to reset to: go back to the seeded version instead.
  await adminNav(page, "Versions")
  await expect(page.getByRole("button", { name: "Reset to default" })).toHaveCount(0)
  const seeded = page.locator("li", { hasText: "e2e fixture" })
  await seeded.getByRole("button", { name: "Load into editor" }).click()
  await page.getByRole("button", { name: "Continue" }).click()
  await seeded.getByRole("button", { name: "Make default" }).click()
  await page.getByRole("button", { name: "Continue" }).click()
  await expect(seeded.getByText("Default")).toBeVisible()
  await expect(page.getByRole("banner")).toContainText("Ready to publish")
  await adminNav(page, "Preview")
  await expect(page.getByText(/to fix before publishing/)).toHaveCount(0)
  await expect(page.getByRole("button", { name: /Aria Ashgrove/ }).or(page.getByLabel(/^Aria Ashgrove\./))).toBeVisible()

  const { seats } = await openRoomUi(browser, ["Ana", "Ben"])
  await expect(seats[0].page.getByText("First to 15")).toBeVisible()
})

for (const width of [390, 1280]) for (const scheme of ["light", "dark"] as const) {
  test(`admin layout and accessibility at ${width}px (${scheme})`, async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme })).newPage()
    await page.goto(ADMIN)
    for (const section of ["Overview", "Cards", "Resources", "Rules", "Achievements", "Relationships", "Versions", "Preview", "Settings", "Library"]) {
      await adminNav(page, section)
      await noOverflow(page)
      await axe(page, `admin-${section}-${width}-${scheme}`)
      await page.screenshot({ path: `test-results/evidence/admin-${width}-${scheme}-${section.toLowerCase()}.png`, fullPage: true })
    }
  })
}

test("the game server does not serve the admin", async ({ request }) => {
  expect((await request.get("/admin.html")).status()).toBe(404)
  expect((await request.get("/admin-api/content", { headers: { "x-trovekit-admin": "1" } })).status()).toBe(404)
  expect((await request.post("/admin-api/active", { headers: { "x-trovekit-admin": "1" }, data: { id: "default" } })).status()).toBe(404)
})
