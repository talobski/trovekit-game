import type { Request } from "@playwright/test"
import { expect, test, type Page } from "./browser-fixtures"
import { starfallContent } from "../tests/fixtures/starfall"
import { adminNav, PHONE } from "./helpers"
import { ISOLATED_PAIRS } from "./ports"

/*
 * Late responses must never replace another pack's editor,
 * discard unsaved work or fill a dialog that has moved on. Each test holds one
 * admin API response, changes packs or edits while it is pending, then
 * releases it. Runs on its own server pair.
 */

test.describe.configure({ mode: "serial" })

const ADMIN = `http://127.0.0.1:${ISOLATED_PAIRS.races + 1}`
const headers = { "x-trovekit-admin": "1" }
const banner = (page: Page) => page.getByRole("banner")
const target = (page: Page) => page.getByLabel("Target points")

/** Holds the next matching request until released. Waits first for the page's own loading to finish, so it holds the request the test triggers. */
async function hold(page: Page, url: string, match: (request: Request) => boolean = () => true) {
  await page.waitForLoadState("networkidle")
  let release!: () => void
  let arrived!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  const seen = new Promise<void>((resolve) => (arrived = resolve))
  let held = false
  await page.route(url, async (route) => {
    if (held || !match(route.request())) return route.fallback()
    held = true
    arrived()
    await gate
    await route.continue()
  })
  return { seen, release }
}

const creating = (name: string) => (request: Request) => request.method() === "POST" && request.postDataJSON()?.name === name

test.beforeAll(async ({ request }) => {
  // A second complete pack, so the race always has somewhere else to go.
  const res = await request.post(`${ADMIN}/admin-api/drafts`, { headers, data: { name: "Second Pack", content: starfallContent(), create: true } })
  expect((await res.json()).content.pack.id).toBe("second-pack")
})

test("a version that finishes loading after the admin switched packs is not applied", async ({ page }) => {
  await page.goto(`${ADMIN}/#/packs/starfall/versions`)
  const load = await hold(page, "**/admin-api/versions/*", (r) => r.method() === "GET")
  await page.locator("li", { hasText: "e2e fixture" }).getByRole("button", { name: "Load into editor" }).click()
  await page.getByRole("button", { name: "Continue" }).click()
  await load.seen
  await adminNav(page, "Second Pack")
  await adminNav(page, "Rules")
  await target(page).fill("27")
  const response = page.waitForResponse("**/admin-api/versions/*")
  load.release()
  await response
  await expect(page).toHaveURL(/#\/packs\/second-pack\/rules$/)
  await expect(banner(page)).toContainText("Second Pack · Draft · Unsaved changes")
  await expect(target(page)).toHaveValue("27")
  await expect(page.getByText(/was not loaded because the editor changed while it was loading/)).toBeVisible()
})

test("an import update whose pack is read after the admin moved on is neither saved nor opened", async ({ page }) => {
  await page.goto(`${ADMIN}/#/packs/second-pack`)
  const before = await (await page.request.get(`${ADMIN}/admin-api/drafts/starfall`, { headers })).json()
  const imported = starfallContent()
  imported.rules.targetPoints = 9
  await page.getByLabel("Import JSON file").setInputFiles({ name: "pack.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) })
  await page.getByRole("button", { name: "Import", exact: true }).click()
  const head = await hold(page, "**/admin-api/drafts/starfall")
  await page.getByRole("dialog").getByRole("button", { name: "Update Starfall Academy" }).click()
  await head.seen
  // The choice waits for the save, so the admin leaves by address (Back, Forward or a typed link).
  await page.evaluate(() => { window.location.hash = "#/packs/second-pack/rules" })
  await expect(page).toHaveURL(/#\/packs\/second-pack\/rules$/)
  const response = page.waitForResponse("**/admin-api/drafts/starfall")
  head.release()
  await response
  await expect(page.getByText(/The import into Starfall Academy was not applied/)).toBeVisible()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page).toHaveURL(/#\/packs\/second-pack\/rules$/)
  await expect(banner(page)).toContainText("Second Pack ·")
  await target(page).fill("28")
  await expect(banner(page)).toContainText("Second Pack · Draft · Unsaved changes")
  // Nothing was saved into the other pack.
  expect(await (await page.request.get(`${ADMIN}/admin-api/drafts/starfall`, { headers })).json()).toEqual(before)
})

test("Open latest after a conflict does not replace a pack opened meanwhile", async ({ page, context }) => {
  await page.goto(`${ADMIN}/#/packs/starfall/rules`)
  const other = await context.newPage()
  await other.goto(`${ADMIN}/#/packs/starfall/rules`)
  await target(other).fill("30")
  await other.getByRole("button", { name: "Save draft", exact: true }).click()
  await expect(banner(other)).not.toContainText("Unsaved changes")
  await target(page).fill("31")
  await page.getByRole("button", { name: "Save draft", exact: true }).click()
  const conflict = page.getByRole("alertdialog")
  await expect(conflict).toContainText("This pack changed in another tab or window")
  const head = await hold(page, "**/admin-api/drafts/starfall")
  await conflict.getByRole("button", { name: "Open latest" }).click()
  await head.seen
  // Still holding unsaved changes: leaving asks, and Discard opens the other pack.
  await adminNav(page, "Second Pack")
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard changes" }).click()
  await expect(banner(page)).toContainText("Second Pack ·")
  await adminNav(page, "Rules")
  await target(page).fill("29")
  const response = page.waitForResponse("**/admin-api/drafts/starfall")
  head.release()
  await response
  await expect(page).toHaveURL(/#\/packs\/second-pack\/rules$/)
  await expect(target(page)).toHaveValue("29")
  await expect(page.getByText(/The latest Starfall Academy was not opened/)).toBeVisible()
})

test("a pack created after the admin left the creation page is kept but not opened over unsaved work", async ({ page }) => {
  await page.goto(`${ADMIN}/#/packs/second-pack`)
  await adminNav(page, "New pack")
  const create = await hold(page, "**/admin-api/drafts", creating("Third Pack"))
  await page.getByLabel("Pack name").fill("Third Pack")
  await page.getByRole("button", { name: "Create manually instead" }).click()
  await create.seen
  await page.getByRole("link", { name: "Back to Library" }).click()
  await adminNav(page, "Second Pack")
  await adminNav(page, "Rules")
  await target(page).fill("26")
  const response = page.waitForResponse((r) => r.url().endsWith("/admin-api/drafts") && r.request().method() === "POST")
  create.release()
  await response
  await expect(page).toHaveURL(/#\/packs\/second-pack\/rules$/)
  await expect(target(page)).toHaveValue("26")
  await expect(page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Third Pack", exact: true })).toBeVisible()
  await expect(page.getByText("Created Third Pack. Open it from the sidebar.")).toBeVisible()
})

test("a duplicate that finishes after the admin moved on is kept but not opened", async ({ page }) => {
  await page.goto(`${ADMIN}/#/packs/second-pack/settings`)
  const create = await hold(page, "**/admin-api/drafts", creating("Fourth Pack"))
  await page.getByLabel("New pack name").fill("Fourth Pack")
  await page.getByRole("button", { name: "Duplicate pack" }).click()
  await create.seen
  await adminNav(page, "Rules")
  await target(page).fill("25")
  const response = page.waitForResponse((r) => r.url().endsWith("/admin-api/drafts") && r.request().method() === "POST")
  create.release()
  await response
  await expect(page).toHaveURL(/#\/packs\/second-pack\/rules$/)
  await expect(target(page)).toHaveValue("25")
  await expect(page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Fourth Pack", exact: true })).toBeVisible()
  await expect(page.getByText("Created Fourth Pack. Open it from the sidebar.")).toBeVisible()
})

test("a publish result never fills the dialog of a later session or another pack", async ({ page, request }) => {
  await page.goto(`${ADMIN}/#/packs/starfall/settings`)
  await page.getByLabel("Version", { exact: true }).fill("1.2.0")
  const publish = await hold(page, "**/admin-api/versions", (r) => r.method() === "POST")
  await page.getByRole("button", { name: "Publish version" }).click()
  await page.getByLabel("Note").fill("Late result")
  await page.getByRole("button", { name: "Publish", exact: true }).click()
  await publish.seen
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await adminNav(page, "Second Pack")
  const response = page.waitForResponse((r) => r.url().endsWith("/admin-api/versions") && r.request().method() === "POST")
  publish.release()
  await response
  await page.getByRole("button", { name: "Publish version" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading", { name: "Publish Second Pack 1.0.0" })).toBeVisible()
  await expect(dialog).not.toContainText("Starfall")
  await expect(dialog.getByRole("button", { name: "Make default" })).toHaveCount(0)
  await dialog.getByRole("button", { name: "Cancel" }).click()
  // The admin is still told that the earlier publish succeeded.
  await expect(page.getByText("Published Starfall Academy 1.2.0. Make it the default from its Versions page when ready.")).toBeVisible()
  // The late result changed nothing else: the default is still the seeded version.
  const content = await (await request.get(`${ADMIN}/admin-api/content`, { headers })).json()
  expect(content.versions.find((v: { id: string }) => v.id === content.active).note).toBe("e2e fixture")
})

test("the sidebar names the default pack in words, on desktop and in the phone sheet", async ({ page, browser }) => {
  await page.goto(`${ADMIN}/#/packs/second-pack`)
  const item = (scope: Page) => scope.getByRole("navigation", { name: "Admin" }).getByRole("listitem").filter({ has: scope.getByRole("link", { name: "Starfall Academy", exact: true }) })
  // Visible words, not only screen-reader text.
  const shown = async (scope: Page) => {
    const label = item(scope).getByText("Default", { exact: true })
    await expect(label).toBeVisible()
    expect((await label.boundingBox())!.width).toBeGreaterThan(20)
  }
  await shown(page)
  const phone = await (await browser.newContext({ viewport: PHONE })).newPage()
  await phone.goto(`${ADMIN}/#/packs/second-pack`)
  await phone.getByRole("button", { name: "Toggle sidebar" }).click()
  await shown(phone)
})

test("a card batch read while the admin edited is not applied over the edit", async ({ page }) => {
  await page.goto(`${ADMIN}/#/packs/second-pack/cards`)
  // Reading the file waits until the test releases it.
  await page.evaluate(() => {
    const w = window as unknown as { readText: typeof File.prototype.text; releaseRead?: () => void }
    w.readText = File.prototype.text
    File.prototype.text = function (this: File) {
      return new Promise((resolve) => { w.releaseRead = () => resolve(w.readText.call(this)) })
    }
  })
  const card = { ...starfallContent().pack.cards[0], id: "batch-one", name: "Batch One", shortName: undefined, art: undefined }
  const batch = { name: "batch.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify([card])) }
  await page.getByLabel("Import cards file").setInputFiles(batch)
  await page.waitForFunction(() => typeof (window as unknown as { releaseRead?: () => void }).releaseRead === "function")
  const costMax = page.getByLabel("Cost max").first()
  const raised = String(Number(await costMax.inputValue()) + 1)
  await costMax.fill(raised)
  await page.evaluate(() => (window as unknown as { releaseRead: () => void }).releaseRead())
  const stale = page.getByRole("alert").filter({ hasText: "Import the file again" })
  const review = page.getByRole("heading", { name: "Review import" })
  await expect(stale.or(review)).toBeVisible()
  // Should a review appear, apply it as an admin would: the earlier edit must survive either way.
  if (await review.isVisible()) {
    await page.getByRole("switch", { name: "Apply this batch to my draft" }).click()
    await page.getByRole("button", { name: "Apply to editor" }).click()
  }
  await expect(costMax).toHaveValue(raised)
  await expect(stale).toBeVisible()
  await expect(review).toHaveCount(0)

  // A fresh import works and keeps the edit.
  await page.evaluate(() => { File.prototype.text = (window as unknown as { readText: typeof File.prototype.text }).readText })
  await page.getByLabel("Import cards file").setInputFiles(batch)
  await page.getByRole("switch", { name: "Apply this batch to my draft" }).click()
  await page.getByRole("button", { name: "Apply to editor" }).click()
  await expect(page.getByRole("button", { name: /Batch One/ })).toBeVisible()
  await expect(costMax).toHaveValue(raised)
  await expect(page.getByRole("alert").filter({ hasText: "Import the file again" })).toHaveCount(0)
})

const saving = (packId: string) => (r: Request) => r.method() === "POST" && r.postDataJSON()?.revision !== undefined && r.postDataJSON()?.content?.pack?.id === packId
const draftOf = async (page: Page, packId: string) => (await (await page.request.get(`${ADMIN}/admin-api/drafts/${packId}`, { headers })).json()).content

test("a save acknowledged after the pack was reopened does not touch the reopened editor", async ({ page }) => {
  await page.goto(`${ADMIN}/#/packs/second-pack/rules`)
  await target(page).fill("33")
  const save = await hold(page, "**/admin-api/drafts", saving("second-pack"))
  await page.getByRole("banner").getByRole("button", { name: "Save draft" }).click()
  await save.seen
  await adminNav(page, "Starfall Academy")
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard changes" }).click()
  await expect(banner(page)).toContainText("Starfall Academy ·")
  // Reopened while the save is still pending: the editor shows what the server had then.
  await adminNav(page, "Second Pack")
  await adminNav(page, "Rules")
  const reopened = await target(page).inputValue()
  expect(reopened).not.toBe("33")
  const response = page.waitForResponse((r) => r.url().endsWith("/admin-api/drafts") && r.request().method() === "POST")
  save.release()
  await response
  // No false "unsaved" state, and the reopened editor still saves over what it loaded: a conflict, not a silent overwrite.
  await expect(banner(page)).not.toContainText("Unsaved changes")
  await expect(target(page)).toHaveValue(reopened)
  expect((await draftOf(page, "second-pack")).rules.targetPoints).toBe(33)
  await target(page).fill("34")
  await page.getByRole("banner").getByRole("button", { name: "Save draft" }).click()
  await expect(page.getByRole("alertdialog")).toContainText("This pack changed in another tab or window")
  expect((await draftOf(page, "second-pack")).rules.targetPoints).toBe(33)
})

test("a save acknowledged after further edits keeps them as unsaved changes", async ({ page }) => {
  await page.goto(`${ADMIN}/#/packs/second-pack/rules`)
  await target(page).fill("35")
  const save = await hold(page, "**/admin-api/drafts", saving("second-pack"))
  await page.getByRole("banner").getByRole("button", { name: "Save draft" }).click()
  await save.seen
  await target(page).fill("36")
  const response = page.waitForResponse((r) => r.url().endsWith("/admin-api/drafts") && r.request().method() === "POST")
  save.release()
  await response
  await expect(page.getByText("Draft saved. It stays private until you publish a version.")).toBeVisible()
  await expect(banner(page)).toContainText("Unsaved changes")
  await expect(target(page)).toHaveValue("36")
  expect((await draftOf(page, "second-pack")).rules.targetPoints).toBe(35)
  // The editor saved over its own save: the next save goes through without a conflict.
  await page.getByRole("banner").getByRole("button", { name: "Save draft" }).click()
  await expect(banner(page)).not.toContainText("Unsaved changes")
  expect((await draftOf(page, "second-pack")).rules.targetPoints).toBe(36)
})

test("a publish acknowledged after further edits keeps them as unsaved changes", async ({ page }) => {
  await page.goto(`${ADMIN}/#/packs/second-pack/settings`)
  await page.getByLabel("Version", { exact: true }).fill("2.0.0")
  const publish = await hold(page, "**/admin-api/versions", (r) => r.method() === "POST")
  await page.getByRole("button", { name: "Publish version" }).click()
  await page.getByLabel("Note").fill("Late acknowledgement")
  await page.getByRole("button", { name: "Publish", exact: true }).click()
  await publish.seen
  await page.keyboard.press("Escape")
  await adminNav(page, "Rules")
  await target(page).fill("37")
  const response = page.waitForResponse((r) => r.url().endsWith("/admin-api/versions") && r.request().method() === "POST")
  publish.release()
  await response
  await expect(page.getByText("Published Second Pack 2.0.0. Make it the default from its Versions page when ready.")).toBeVisible()
  await expect(banner(page)).toContainText("Second Pack · Published 2.0.0 · Unsaved changes")
  await expect(target(page)).toHaveValue("37")
  await page.getByRole("banner").getByRole("button", { name: "Save draft" }).click()
  await expect(banner(page)).not.toContainText("Unsaved changes")
  expect((await draftOf(page, "second-pack")).rules.targetPoints).toBe(37)
})
