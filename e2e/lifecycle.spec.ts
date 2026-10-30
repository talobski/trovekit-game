import { expect, test, type Page } from "./browser-fixtures"
import { starfallContent } from "../tests/fixtures/starfall"
import { adminNav, axe, DESKTOP, noOverflow, PHONE } from "./helpers"
import { EMPTY_PAIRS, ISOLATED_PAIRS } from "./ports"

/*
 * The pack lifecycle in the browser: publishing is separate from
 * Make default, the library and Versions tab name each state plainly, a stale
 * tab cannot silently overwrite a newer draft, and an import that reuses a pack
 * ID asks what to do. Runs on its own server pairs because it changes defaults.
 */

test.describe.configure({ mode: "serial" })

const ADMIN = `http://127.0.0.1:${ISOLATED_PAIRS.lifecycle + 1}`
const FRESH_GAME = `http://localhost:${EMPTY_PAIRS.firstPublish}`
const FRESH_ADMIN = `http://127.0.0.1:${EMPTY_PAIRS.firstPublish + 1}`
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/evidence/lifecycle-${name}.png`, fullPage: true })
const json = (content: unknown, name = "pack.json") => ({ name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(content)) })

async function importPack(page: Page, content: unknown) {
  await page.getByLabel("Import JSON file").setInputFiles(json(content))
  await page.getByRole("button", { name: "Import", exact: true }).click()
}

/** The editor matches what is saved. */
const saved = (page: Page) => expect(page.getByRole("banner")).not.toContainText("Unsaved changes")

async function publish(page: Page, note: string) {
  await page.getByRole("button", { name: "Publish version" }).click()
  await page.getByLabel("Note").fill(note)
  await page.getByRole("button", { name: "Publish", exact: true }).click()
}

test("the first published pack offers Make default, and the library never claims nothing is published", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(FRESH_ADMIN)
  await expect(page.getByRole("heading", { name: "Create your first pack" })).toBeVisible()
  await importPack(page, starfallContent())
  await expect(page.getByRole("banner")).toContainText("Starfall Academy · Draft")
  await page.getByRole("button", { name: "Publish version" }).click()
  await expect(page.getByRole("dialog")).toContainText("Creates the first version of this pack.")
  await page.getByRole("button", { name: "Publish", exact: true }).click()
  const done = page.getByRole("dialog")
  await expect(done.getByRole("heading", { name: "Published Starfall Academy 1.0.0" })).toBeVisible()
  await expect(done).toContainText("No version is the default yet, so players cannot create rooms.")
  await axe(page, "first publish next step")
  await shot(page, "first-publish-make-default")
  await done.getByRole("button", { name: "Not now" }).click()
  // Published, no default: players still cannot create rooms.
  expect(await (await page.request.get(`${FRESH_GAME}/api/packs`)).json()).toEqual([])

  await adminNav(page, "Library")
  await expect(page.getByText("No default game", { exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Create your first pack" })).toHaveCount(0)
  await expect(page.getByText("Nothing is published yet")).toHaveCount(0)
  await shot(page, "library-no-default")
  await page.getByRole("button", { name: "Make default: Starfall Academy" }).click()
  await page.getByRole("button", { name: "Continue" }).click()
  await expect(page.getByText("New rooms use Starfall Academy 1.0.0.")).toBeVisible()

  const game = await page.context().newPage()
  await game.goto(FRESH_GAME)
  await game.getByLabel("Your name").fill("Ana")
  await expect(game.getByRole("button", { name: "Create room" })).toBeEnabled()
  await expect(game.getByRole("combobox")).toHaveCount(0)
})

test("draft, latest published and default stay distinct through publish, Make default and rollback", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(ADMIN)
  await expect(page.getByRole("banner")).toContainText("Starfall Academy · Published 1.0.0")

  // Save a draft; a reload reopens it rather than the published version.
  await adminNav(page, "Rules")
  await page.getByLabel("Target points").fill("18")
  await page.getByRole("button", { name: "Save draft", exact: true }).click()
  await saved(page)
  await page.reload()
  await expect(page.getByRole("banner")).toContainText("Starfall Academy · Draft")
  await adminNav(page, "Rules")
  await expect(page.getByLabel("Target points")).toHaveValue("18")

  // Same version number as the published one: warned, not blocked.
  await page.getByRole("button", { name: "Publish version" }).click()
  await expect(page.getByText("Version 1.0.0 is already published")).toBeVisible()
  await axe(page, "publish duplicate version warning")
  await shot(page, "publish-duplicate-warning")
  await page.getByRole("button", { name: "Cancel" }).click()
  await adminNav(page, "Settings")
  await page.getByLabel("Version", { exact: true }).fill("1.1.0")
  await publish(page, "Longer games")
  await expect(page.getByText("Version 1.1.0 is already published")).toHaveCount(0)
  await expect(page.getByRole("dialog")).toContainText("New rooms still use 1.0.0 until you make this version the default.")
  await page.getByRole("button", { name: "Not now" }).click()

  // Library: the published draft is cleared; latest 1.1.0; the default is still the older 1.0.0.
  await adminNav(page, "Library")
  const row = page.getByRole("list", { name: "Content packs" }).getByRole("listitem").filter({ hasText: "Starfall Academy" })
  await expect(row).toContainText("Latest published1.1.0")
  await expect(row).toContainText("Default1.0.0 (older version)")
  await expect(row.getByText("Unpublished changes")).toHaveCount(0)
  await expect(row.getByRole("link", { name: "Edit: Starfall Academy" })).toBeVisible()

  // A new draft, then Make default from the library: the draft survives.
  await row.getByRole("link", { name: "Edit: Starfall Academy" }).click()
  await adminNav(page, "Rules")
  await page.getByLabel("Target points").fill("20")
  await page.getByRole("button", { name: "Save draft", exact: true }).click()
  await adminNav(page, "Library")
  await row.getByRole("button", { name: "Make default: Starfall Academy" }).click()
  await page.getByRole("button", { name: "Continue" }).click()
  await expect(page.getByText("New rooms use Starfall Academy 1.1.0.")).toBeVisible()
  await expect(row.getByText("Unpublished changes")).toBeVisible()
  await expect(row.getByRole("link", { name: "Continue draft: Starfall Academy" })).toBeVisible()

  // Versions: roll back to 1.0.0. Latest stays 1.1.0 and the draft is still there.
  await row.getByRole("link", { name: "Versions: Starfall Academy" }).click()
  const versions = page.getByRole("list", { name: "Published versions" })
  const older = versions.getByRole("listitem").filter({ hasText: "1.0.0 ·" })
  await older.getByRole("button", { name: "Make default" }).click()
  await expect(page.getByRole("alertdialog")).toContainText("This is an older version (a rollback).")
  await page.getByRole("button", { name: "Continue" }).click()
  await expect(older.getByText("Default", { exact: true })).toBeVisible()
  await expect(versions.getByRole("listitem").filter({ hasText: "1.1.0 ·" }).getByText("Latest", { exact: true })).toBeVisible()
  await adminNav(page, "Rules")
  await expect(page.getByLabel("Target points")).toHaveValue("20")
})

test("a second tab cannot silently overwrite a newer draft", async ({ page, context }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(ADMIN)
  const other = await context.newPage()
  await other.setViewportSize(DESKTOP)
  await other.goto(ADMIN)
  for (const tab of [page, other]) {
    await adminNav(tab, "Rules")
    await expect(tab.getByLabel("Target points")).toHaveValue("20")
  }
  await page.getByLabel("Target points").fill("21")
  await page.getByRole("button", { name: "Save draft", exact: true }).click()
  await saved(page)

  await other.getByLabel("Target points").fill("12")
  await other.getByRole("button", { name: "Save draft", exact: true }).click()
  const conflict = other.getByRole("alertdialog")
  await expect(conflict.getByRole("heading", { name: "This pack changed in another tab or window" })).toBeVisible()
  await axe(other, "draft conflict")
  await shot(other, "draft-conflict")
  await conflict.getByRole("button", { name: "Open latest" }).click()
  await expect(other.getByLabel("Target points")).toHaveValue("21")

  // The newer tab saves again; the first, now stale, chooses to replace it explicitly.
  await other.getByLabel("Target points").fill("22")
  await other.getByRole("button", { name: "Save draft", exact: true }).click()
  await saved(other)
  await page.getByLabel("Target points").fill("23")
  await page.getByRole("button", { name: "Save draft", exact: true }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Replace with mine" }).click()
  await saved(page)
  const head = await (await page.request.get(`${ADMIN}/admin-api/drafts/starfall`, { headers: { "x-trovekit-admin": "1" } })).json()
  expect(head.content.rules.targetPoints).toBe(23)
})

test("an import that reuses a pack ID requires choosing update or a separate pack", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(ADMIN)
  const imported = starfallContent()
  imported.rules.targetPoints = 9
  await importPack(page, imported)
  const choice = page.getByRole("dialog")
  await expect(choice.getByRole("heading", { name: "Starfall Academy is already in your library" })).toBeVisible()
  await axe(page, "import choice")
  await shot(page, "import-choice")
  await choice.getByRole("button", { name: "Create separate pack" }).click()
  await expect(page.getByText("Created Starfall Academy with the ID starfall-academy")).toBeVisible()
  await expect(page.getByRole("banner")).toContainText("Starfall Academy · Draft")

  // Update: the import is saved as the existing pack's draft and opens.
  await importPack(page, imported)
  await page.getByRole("dialog").getByRole("button", { name: "Update Starfall Academy" }).click()
  await expect(page).toHaveURL(/#\/packs\/starfall$/)
  await expect(page.getByRole("banner")).toContainText("Starfall Academy · Draft")
  await saved(page)
  const head = await (await page.request.get(`${ADMIN}/admin-api/drafts/starfall`, { headers: { "x-trovekit-admin": "1" } })).json()
  expect(head.content.rules.targetPoints).toBe(9)
})

for (const [viewport, label] of [[PHONE, "phone"], [DESKTOP, "desktop"]] as const)
  for (const scheme of ["light", "dark"] as const)
    test(`library and versions read clearly (${label}, ${scheme})`, async ({ browser }) => {
      const page = await (await browser.newContext({ viewport, colorScheme: scheme })).newPage()
      await page.goto(ADMIN)
      await adminNav(page, "Library")
      await expect(page.getByRole("list", { name: "Content packs" })).toBeVisible()
      await noOverflow(page)
      await axe(page, `library ${label} ${scheme}`)
      await shot(page, `library-${label}-${scheme}`)
      await page.getByRole("link", { name: "Versions: Starfall Academy", exact: true }).click()
      await expect(page.getByRole("list", { name: "Published versions" })).toBeVisible()
      await noOverflow(page)
      await axe(page, `versions ${label} ${scheme}`)
      await shot(page, `versions-${label}-${scheme}`)
    })

test("if the last pack cannot be reopened, the admin shows the library instead of loading forever", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  let failures = 0
  await page.route("**/admin-api/drafts/*", (route) => {
    if (route.request().method() !== "GET") return route.continue()
    failures++
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "SERVER_ERROR", message: "Something went wrong" }) })
  })
  await page.goto(ADMIN)
  await expect(page.getByText("Could not open Starfall Academy: Something went wrong")).toBeVisible()
  await expect(page.getByRole("status").filter({ hasText: "Loading content" })).toHaveCount(0)
  await expect(page.getByRole("list", { name: "Content packs" })).toBeVisible()
  await expect(page).toHaveURL(/#\/library$/)
  await expect(page.getByRole("heading", { name: "Library", level: 1 })).toBeVisible()
  expect(failures).toBe(1)
  // Once the server answers again, the pack opens normally from the library.
  await page.unroute("**/admin-api/drafts/*")
  await page.getByRole("link", { name: /^(Continue draft|Edit): Starfall Academy$/ }).first().click()
  await expect(page.getByRole("banner")).toContainText("Starfall Academy ·")
})
