import { expect, test } from "./browser-fixtures"
import { adminNav, axe, DESKTOP, noOverflow, PHONE } from "./helpers"

/*
 * A new installation: the 5282/5283 pair runs on an empty data directory, so
 * there are no packs, no rooms and nothing to fall back to. The game explains
 * that rooms need a published pack; the admin opens on its library and creates
 * a pack from the blank template. Nothing here is published.
 */

const GAME = "http://localhost:5282"
const ADMIN = "http://127.0.0.1:5283"
/** Words from any built-in theme would mean demo content leaked in. */
const THEMED = /basketball|prospect|franchise|recruit|starfall|motes|trovekit classic/i

test.describe.configure({ mode: "serial" })

test("the game API offers no packs and refuses to create rooms", async ({ request }) => {
  expect(await (await request.get(`${GAME}/api/packs`)).json()).toEqual([])
  const res = await request.post(`${GAME}/api/rooms`, { data: { name: "Ana" } })
  expect(res.status()).toBe(409)
  expect(await res.json()).toMatchObject({ code: "NO_CONTENT" })
})

for (const [viewport, label] of [
  [PHONE, "phone"],
  [DESKTOP, "desktop"],
] as const)
  for (const scheme of ["light", "dark"] as const)
    test(`Home explains the empty library (${label}, ${scheme})`, async ({ browser }) => {
      const page = await (await browser.newContext({ viewport, colorScheme: scheme })).newPage()
      await page.goto(GAME)
      await expect(page).toHaveTitle("Trovekit Game")
      await expect(page.getByRole("heading", { name: "Trovekit Game", exact: true })).toBeVisible()
      await expect(page.getByText("No game available yet")).toBeVisible()
      await page.getByLabel("Your name").fill("Ana")
      await expect(page.getByRole("button", { name: "Create room" })).toBeDisabled()
      await expect(page.getByRole("combobox", { name: "Content pack" })).toHaveCount(0)
      // Joining an existing room is still possible.
      await page.getByLabel("Room code").fill("ABC234")
      await expect(page.getByRole("button", { name: "Join", exact: true })).toBeEnabled()
      expect(await page.locator("main").textContent()).not.toMatch(THEMED)
      await noOverflow(page)
      await axe(page, `empty home ${label} ${scheme}`)
      await page.screenshot({ path: `test-results/evidence/blank-home-${label}-${scheme}.png` })
    })

for (const [viewport, label] of [
  [PHONE, "phone"],
  [DESKTOP, "desktop"],
] as const)
  test(`the admin opens on an empty library (${label})`, async ({ browser }) => {
    const page = await (await browser.newContext({ viewport })).newPage()
    await page.goto(ADMIN)
    await expect(page).toHaveTitle("Trovekit Game Admin")
    await expect(page.getByText("Trovekit Game Admin", { exact: true }).locator("visible=true")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Create your first pack" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Library", level: 1 })).toBeVisible()
    // No editor, no Save, no built-in content and no way to restore any.
    await expect(page.getByRole("link", { name: "Overview" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Publish version" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: /Reset to default|Example pack/ })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Import pack" }).first()).toBeVisible()
    await expect(page.getByRole("link", { name: "Create pack" })).toHaveAttribute("href", "#/new")
    // The library itself creates nothing: no name form.
    await expect(page.getByLabel("Pack name")).toHaveCount(0)
    expect(await page.locator("main").textContent()).not.toMatch(THEMED)
    await noOverflow(page)
    await axe(page, `empty admin ${label}`)
    await page.screenshot({ path: `test-results/evidence/blank-admin-${label}.png`, fullPage: true })
  })

test("Create manually instead starts a draft from the blank template, which cannot be published until it has cards", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(ADMIN)
  await expect(page).toHaveTitle("Trovekit Game Admin")
  await page.getByRole("link", { name: "Create pack" }).click()
  await page.getByLabel("Pack name").fill("My pack")
  await page.getByRole("button", { name: "Create manually instead" }).click()
  await expect(page.getByText("Pack created", { exact: true })).toBeVisible()
  // The new pack's workspace opens on its Overview, with the setup checklist.
  await expect(page).toHaveURL(/#\/packs\/my-pack$/)
  await expect(page.getByRole("banner")).toContainText("My pack · Draft")
  await expect(page.getByRole("heading", { name: "My pack", level: 1 })).toBeVisible()
  const steps = page.getByRole("list", { name: "Setup steps" })
  await expect(steps).toContainText("Configure resources: Done")
  await expect(steps).toContainText("Add cards: To do")
  await expect(steps).toContainText("Add cards to every group before publishing.")
  await adminNav(page, "Settings")
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("My pack")
  await expect(page.getByLabel("Resources (many)")).toHaveValue("Resources")
  expect(await page.locator("main").textContent()).not.toMatch(THEMED)
  // A blank draft is not publishable yet: it has no cards.
  await expect(page.getByRole("button", { name: "Publish version" })).toBeDisabled()
  await page.getByRole("button", { name: "Review requirements" }).click()
  await expect(page.getByRole("heading", { name: "My pack", level: 1 })).toBeVisible()
  await adminNav(page, "Library")
  const row = page.getByRole("list", { name: "Content packs" }).getByRole("listitem")
  await expect(row).toContainText("my-pack")
  await expect(row).toContainText("DraftUnpublished changes")
  await expect(row).toContainText("Latest publishedNot published")
  await expect(page.getByText("Nothing is published yet. Publish a version, then make it the default so players can create rooms.")).toBeVisible()
  await noOverflow(page)
  await axe(page, "blank draft")
  await page.screenshot({ path: "test-results/evidence/blank-admin-draft.png", fullPage: true })

  // Still nothing for players: drafts are private.
  await page.goto(GAME)
      await expect(page).toHaveTitle("Trovekit Game")
      await expect(page.getByRole("heading", { name: "Trovekit Game", exact: true })).toBeVisible()
  await expect(page.getByText("No game available yet")).toBeVisible()
})
