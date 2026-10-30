import { expect, test, type Page } from "./browser-fixtures"
import { adminNav, axe, DESKTOP, noOverflow, PHONE } from "./helpers"
import { ISOLATED_PAIRS } from "./ports"

/*
 * The sidebar admin. Packs are created from a name and open on their
 * Overview; unsaved edits survive moving between sections and to the library;
 * opening another pack asks first, also on Back and Forward; direct links,
 * refreshes and unknown packs land somewhere sensible. Runs on its own pair
 * because it creates packs and saves drafts.
 */

test.describe.configure({ mode: "serial" })

const ADMIN = `http://127.0.0.1:${ISOLATED_PAIRS.workspace + 1}`
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/evidence/workspace-${name}.png`, fullPage: true })
const title = (page: Page) => page.locator("#page-title")
const leave = (page: Page) => page.getByRole("alertdialog")

test("a new pack from a name: Overview checklist, edits kept across sections and the library", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(`${ADMIN}/#/library`)
  await adminNav(page, "New pack")
  await page.getByLabel("Pack name").fill("Ocean Tales")
  await page.getByRole("button", { name: "Create manually instead" }).click()
  await expect(page).toHaveURL(/#\/packs\/ocean-tales$/)
  await expect(title(page)).toHaveText("Ocean Tales")
  const steps = page.getByRole("list", { name: "Setup steps" })
  await expect(steps).toContainText("Configure resources: Done")
  await expect(steps).toContainText("Configure card groups: Done")
  await expect(steps).toContainText("Add cards: To do")
  await expect(steps).toContainText("Review rules and achievements: Not checked yet")
  await axe(page, "setup checklist")
  await shot(page, "setup-checklist")

  // Relationships with no cards: nothing to choose from, so no way to create a broken one.
  await adminNav(page, "Relationships")
  await expect(page.getByRole("button", { name: "Add relationship" })).toBeDisabled()
  await expect(page.getByText("Add at least two cards to a tiered group to create a relationship.")).toBeVisible()

  // Unsaved edits survive other sections and the library.
  await adminNav(page, "Rules")
  await page.getByLabel("Target points").fill("21")
  await adminNav(page, "Resources")
  await page.getByLabel("Label (resource-1)").fill("Coral")
  await adminNav(page, "Library")
  await expect(page.getByRole("list", { name: "Content packs" }).getByRole("listitem").filter({ hasText: "ocean-tales" })).toContainText("EditorUnsaved changes")
  await adminNav(page, "Ocean Tales")
  await adminNav(page, "Rules")
  await expect(page.getByLabel("Target points")).toHaveValue("21")
  await adminNav(page, "Overview")
  await expect(steps).toContainText("Coral")
  await expect(page.getByRole("banner")).toContainText("Ocean Tales · Draft · Unsaved changes")
})

test("opening another pack asks first: Cancel stays, Save draft saves, Discard drops", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(`${ADMIN}/#/packs/ocean-tales/rules`)
  await page.getByLabel("Target points").fill("22")
  await adminNav(page, "Starfall Academy")
  await expect(leave(page)).toContainText("Save changes to Ocean Tales?")
  await axe(page, "leave dialog")
  await shot(page, "leave-dialog")
  await leave(page).getByRole("button", { name: "Cancel" }).click()
  await expect(page).toHaveURL(/#\/packs\/ocean-tales\/rules$/)
  await expect(page.getByLabel("Target points")).toHaveValue("22")

  await adminNav(page, "Starfall Academy")
  await leave(page).getByRole("button", { name: "Save draft" }).click()
  await expect(page).toHaveURL(/#\/packs\/starfall$/)
  await expect(title(page)).toHaveText("Starfall Academy")
  const saved = await (await page.request.get(`${ADMIN}/admin-api/drafts/ocean-tales`, { headers: { "x-trovekit-admin": "1" } })).json()
  expect(saved.content.rules.targetPoints).toBe(22)

  await adminNav(page, "Rules")
  await page.getByLabel("Target points").fill("30")
  await adminNav(page, "Ocean Tales")
  await leave(page).getByRole("button", { name: "Discard changes" }).click()
  await expect(title(page)).toHaveText("Ocean Tales")
  await adminNav(page, "Starfall Academy")
  await adminNav(page, "Rules")
  await expect(page.getByLabel("Target points")).toHaveValue("15")
})

test("a failed save keeps the admin on the pack with its changes", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(`${ADMIN}/#/packs/ocean-tales/rules`)
  await page.getByLabel("Target points").fill("23")
  await page.route("**/admin-api/drafts", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Disk full" }) }))
  await adminNav(page, "Starfall Academy")
  await leave(page).getByRole("button", { name: "Save draft" }).click()
  await expect(page.getByText("Disk full")).toBeVisible()
  await expect(leave(page)).toHaveCount(0)
  await expect(page).toHaveURL(/#\/packs\/ocean-tales\/rules$/)
  await expect(page.getByLabel("Target points")).toHaveValue("23")
  await expect(page.getByRole("banner")).toContainText("Unsaved changes")
})

test("Back and Forward follow the history and ask before replacing unsaved changes", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(`${ADMIN}/#/packs/starfall/cards`)
  await adminNav(page, "Ocean Tales")
  await adminNav(page, "Rules")
  await page.getByLabel("Target points").fill("24")
  await page.goBack()
  await expect(page).toHaveURL(/#\/packs\/ocean-tales$/)
  // Back again would open Starfall: asks, and Cancel leaves the history where it was.
  await page.goBack()
  await expect(leave(page)).toBeVisible()
  await expect(page).toHaveURL(/#\/packs\/ocean-tales$/)
  await leave(page).getByRole("button", { name: "Cancel" }).click()
  await page.goForward()
  await expect(page).toHaveURL(/#\/packs\/ocean-tales\/rules$/)
  await expect(page.getByLabel("Target points")).toHaveValue("24")
  await page.goBack()
  await page.goBack()
  await leave(page).getByRole("button", { name: "Discard changes" }).click()
  await expect(page).toHaveURL(/#\/packs\/starfall\/cards$/)
  await expect(title(page)).toHaveText("Cards")
  await page.goForward()
  await expect(page).toHaveURL(/#\/packs\/ocean-tales$/)
  await expect(page.getByRole("banner")).toContainText("Ocean Tales · Draft")
  await expect(page.getByRole("banner")).not.toContainText("Unsaved changes")
})

test("direct links and refreshes open the named section; unknown packs fall back to the library", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(`${ADMIN}/#/packs/starfall/versions`)
  await expect(title(page)).toHaveText("Versions")
  await page.reload()
  await expect(title(page)).toHaveText("Versions")
  // The explicit URL wins over the remembered pack.
  await page.goto(`${ADMIN}/#/library`)
  await expect(title(page)).toHaveText("Library")
  await page.goto(`${ADMIN}/#/packs/not-a-pack/cards`)
  await expect(page.getByText('There is no pack "not-a-pack" in your library.')).toBeVisible()
  await expect(page).toHaveURL(/#\/library$/)
  await page.goto(`${ADMIN}/#/nonsense`)
  await expect(title(page)).toHaveText("Library")
})

for (const scheme of ["light", "dark"] as const)
  test(`the phone sidebar is a sheet that closes on navigation (${scheme})`, async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: PHONE, colorScheme: scheme })).newPage()
    await page.goto(`${ADMIN}/#/packs/starfall`)
    await expect(page.getByRole("navigation", { name: "Admin" })).toBeHidden()
    await page.getByRole("button", { name: "Toggle sidebar" }).click()
    const sheet = page.getByRole("dialog", { name: "Admin navigation" })
    await expect(sheet).toBeVisible()
    await noOverflow(page)
    await axe(page, `phone sidebar ${scheme}`)
    await shot(page, `phone-sidebar-${scheme}`)
    await sheet.getByRole("link", { name: "Cards", exact: true }).click()
    await expect(sheet).toBeHidden()
    await expect(page).toHaveURL(/#\/packs\/starfall\/cards$/)
    await expect(page.getByRole("heading", { name: "Cards", level: 1 })).toBeFocused()
    // Escape closes it and returns focus to the menu button.
    await page.getByRole("button", { name: "Toggle sidebar" }).click()
    await expect(sheet.getByRole("link", { name: "Library" })).toBeInViewport()
    // The sheet opens on the current page's link.
    await expect(sheet.getByRole("link", { name: "Cards", exact: true })).toBeFocused()
    await page.keyboard.press("Escape")
    await expect(sheet).toBeHidden()
    await expect(page.getByRole("button", { name: "Toggle sidebar" })).toBeFocused()
    await shot(page, `phone-cards-${scheme}`)
  })

test("the desktop sidebar collapses and expands from the keyboard", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(`${ADMIN}/#/packs/starfall`)
  const nav = page.getByRole("navigation", { name: "Admin" })
  await expect(nav.getByRole("link", { name: "Library" })).toBeInViewport()
  await page.getByRole("button", { name: "Toggle sidebar" }).focus()
  await page.keyboard.press("Enter")
  await expect(nav.getByRole("link", { name: "Library" })).not.toBeInViewport()
  await noOverflow(page)
  // Collapsed, the page uses the full width and stays usable.
  await page.getByRole("link", { name: "Version history" }).click()
  await expect(page.locator("#page-title")).toHaveText("Versions")
  await page.getByRole("button", { name: "Toggle sidebar" }).focus()
  await page.keyboard.press("Enter")
  await expect(nav.getByRole("link", { name: "Library" })).toBeInViewport()
})

for (const [viewport, label] of [[PHONE, "phone"], [DESKTOP, "desktop"]] as const)
  test(`the setup checklist reads clearly in dark mode (${label})`, async ({ browser }) => {
    const page = await (await browser.newContext({ viewport, colorScheme: "dark" })).newPage()
    await page.goto(`${ADMIN}/#/packs/ocean-tales`)
    await expect(page.getByRole("list", { name: "Setup steps" })).toBeVisible()
    await noOverflow(page)
    await axe(page, `setup checklist dark ${label}`)
    await shot(page, `setup-checklist-dark-${label}`)
  })
