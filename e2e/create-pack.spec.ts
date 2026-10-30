import type { Route } from "@playwright/test"
import { expect, test, type Page } from "./browser-fixtures"
import { starfallBundle, starfallContent } from "../tests/fixtures/starfall"
import { adminNav, axe, DESKTOP, noOverflow, PHONE } from "./helpers"
import { EMPTY_PAIRS, ISOLATED_PAIRS } from "./ports"

/*
 * Creating a pack. Create pack opens one page that copies a prompt
 * for the admin's AI assistant and imports what it returns through the usual
 * import review; Create manually instead makes an empty draft. Visiting,
 * typing, copying and leaving save nothing. Runs on an empty pair (a first
 * visit) and a seeded one (an import that reuses an installed pack's ID).
 */

test.describe.configure({ mode: "serial" })

const FRESH = `http://127.0.0.1:${EMPTY_PAIRS.firstCreation + 1}`
const SEEDED = `http://127.0.0.1:${ISOLATED_PAIRS.creation + 1}`
const headers = { "x-trovekit-admin": "1" }
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/evidence/create-${name}.png`, fullPage: true })
const title = (page: Page) => page.locator("#page-title")
const packIds = async (page: Page, admin: string) => ((await (await page.request.get(`${admin}/admin-api/packs`, { headers })).json()) as { id: string }[]).map((p) => p.id)
const json = (content: unknown, name = "pack.json") => ({ name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(content)) })

/** Choose a file with the page's own Import pack file button. */
async function importFile(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  const chooser = page.waitForEvent("filechooser")
  await page.getByRole("button", { name: "Import pack file" }).click()
  await (await chooser).setFiles(file)
}

/** Import from the review: one button, no extra confirmation. */
async function openReviewed(page: Page) {
  await expect(page.getByRole("heading", { name: "Review import" })).toBeVisible()
  await expect(page.getByRole("switch")).toHaveCount(0)
  await page.getByRole("button", { name: "Import", exact: true }).click()
}

/** A complete pack under another identity. */
const another = (id: string, name: string, description = "") => {
  const content = starfallContent()
  Object.assign(content.pack, { id, name, ...(description ? { description } : {}) })
  return content
}
const head = async (page: Page, id: string) => (await page.request.get(`${SEEDED}/admin-api/drafts/${id}`, { headers })).json()

test("Create pack opens the creation page, and visiting, typing, copying or leaving saves nothing", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: FRESH })
  await page.setViewportSize(DESKTOP)
  await page.goto(FRESH)
  await expect(page.getByRole("heading", { name: "Create your first pack" })).toBeVisible()
  await page.getByRole("link", { name: "Create pack" }).click()

  // One focused page: no sidebar, no choice between AI and manual.
  await expect(page).toHaveURL(/#\/new$/)
  await expect(title(page)).toHaveText("Create your content pack")
  await expect(title(page)).toBeFocused()
  await expect(page.getByRole("navigation", { name: "Admin" })).toHaveCount(0)
  await expect(page.getByRole("banner")).toContainText("Trovekit Game Admin")
  await expect(page.getByRole("banner")).toContainText("Create pack")
  const steps = page.getByRole("list", { name: "Create with an AI assistant" })
  await expect(steps.getByRole("heading", { level: 2 })).toHaveText(["Step 1: Generate", "Step 2: Import", "Step 3: Review"])
  await expect(page.getByRole("button", { name: "Create manually instead" })).toBeVisible()
  await expect(page.getByRole("contentinfo")).toContainText("Prefer to build it yourself? Start from an empty pack.")
  // Placeholders only: nothing is filled in for the admin.
  await expect(page.getByLabel("Pack name")).toHaveAttribute("placeholder", "e.g. Mythic Realms")
  await expect(page.getByLabel("Pack name")).toHaveValue("")
  const description = page.getByLabel("Describe your game (optional)")
  await expect(description).toHaveAttribute("placeholder", "The theme, setting, characters or style you have in mind.")
  await expect(description).toHaveAccessibleDescription("Example: A fantasy strategy card game about collecting mythical creatures and ancient artifacts.")

  // The prompt is for a named pack.
  await page.getByRole("button", { name: "Copy AI prompt" }).click()
  await expect(page.getByLabel("Pack name")).toBeFocused()
  await expect(page.getByText("Enter a pack name.")).toBeVisible()
  await expect(page.getByRole("status").filter({ hasText: "Prompt copied" })).toHaveCount(0)

  await page.getByLabel("Pack name").fill("Moon Garden")
  await page.getByLabel("Describe your game").fill("A calm game about tending a moonlit garden of glowing flowers.")
  // The example stays visible while typing.
  await expect(page.getByText("Example: A fantasy strategy card game about collecting mythical creatures and ancient artifacts.")).toBeVisible()
  await page.getByRole("button", { name: "Copy AI prompt" }).click()
  await expect(page.getByRole("status").filter({ hasText: "Prompt copied. Paste it into your AI assistant." })).toBeVisible()
  const prompt = await page.evaluate(() => navigator.clipboard.readText())
  expect(prompt).toContain('Set pack.id to "moon-garden" and pack.name to "Moon Garden" exactly')
  expect(prompt).toContain('"""\nA calm game about tending a moonlit garden of glowing flowers.\n"""')
  expect(prompt).toContain("Return one JSON object {pack, rules}")
  expect(prompt).toContain("Generate at least 60 unique cards")
  expect(prompt).toContain('"id": "moon-garden"')
  expect(JSON.parse(prompt.split("Content JSON schema:\n")[1]).properties).toHaveProperty("rules")
  await axe(page, "creation copied")
  await shot(page, "copied")

  // A changed form needs a fresh copy.
  await page.getByLabel("Describe your game").fill("A calm game about moonlit flowers.")
  await expect(page.getByText("Prompt copied")).toHaveCount(0)

  await page.getByRole("link", { name: "Back to Library" }).click()
  await expect(title(page)).toHaveText("Library")
  await expect(title(page)).toBeFocused()
  expect(await packIds(page, FRESH)).toEqual([])

  // Back and Forward, and a refresh: the page opens again, empty, and still nothing is saved.
  await page.goBack()
  await expect(title(page)).toHaveText("Create your content pack")
  await expect(page.getByLabel("Pack name")).toHaveValue("")
  await page.goForward()
  await expect(title(page)).toHaveText("Library")
  await page.goBack()
  await page.getByLabel("Pack name").fill("Moon Garden")
  await page.reload()
  await expect(title(page)).toHaveText("Create your content pack")
  await expect(page.getByLabel("Pack name")).toHaveValue("")
  expect(await packIds(page, FRESH)).toEqual([])
})

test("files that are not packs are explained and nothing opens", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(`${FRESH}/#/new`)
  await importFile(page, { name: "reply.json", mimeType: "application/json", buffer: Buffer.from("Here is your pack: {") })
  const blocked = page.getByRole("dialog", { name: "Import blocked" })
  await expect(blocked).toContainText("Not valid JSON")
  await page.keyboard.press("Escape")

  const broken = starfallContent()
  broken.pack.cards[0].permanentResource = "missing"
  await importFile(page, json(broken))
  await expect(blocked).toContainText("pack.json was not imported.")
  await expect(blocked.getByRole("region", { name: "Issues" })).toBeVisible()
  await shot(page, "blocked")
  await page.keyboard.press("Escape")
  await expect(page).toHaveURL(/#\/new$/)
  expect(await packIds(page, FRESH)).toEqual([])
})

test("an import is saved as a draft and opens in its workspace, under the file's name when it differs", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(`${SEEDED}/#/library`)
  await adminNav(page, "New pack")
  await page.getByLabel("Pack name").fill("Moon Garden")
  // No prompt copied first: any pack file can be imported.
  await importFile(page, json(another("moon-tales", "Moon Tales")))
  await expect(page.getByRole("dialog")).toContainText("This file names the pack Moon Tales, not Moon Garden. It keeps the file's name, which you can change in Settings.")
  await openReviewed(page)
  await expect(page).toHaveURL(/#\/packs\/moon-tales$/)
  await expect(page.getByText("Imported Moon Tales and saved it as a draft.")).toBeVisible()
  await expect(page.getByRole("banner")).toContainText("Moon Tales · Draft")
  await expect(page.getByRole("banner")).not.toContainText("Unsaved changes")
  await expect(page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Moon Tales", exact: true })).toBeVisible()
  expect(await head(page, "moon-tales")).toMatchObject({ source: "draft", content: { pack: { id: "moon-tales", name: "Moon Tales" } } })
  // Saved, not published or made the default.
  const library = await (await page.request.get(`${SEEDED}/admin-api/content`, { headers })).json()
  expect(library.versions.some((v: { packId: string }) => v.packId === "moon-tales")).toBe(false)
  // A refresh keeps it.
  await page.reload()
  await expect(page.getByRole("banner")).toContainText("Moon Tales · Draft")
  await expect(title(page)).toHaveText("Moon Tales")
  // The creation page made way for the pack: Back returns to the library.
  await page.goBack()
  await expect(page).toHaveURL(/#\/library$/)
})

test("a ZIP with images imports from the creation page", async ({ page }) => {
  const { zip } = await starfallBundle({ id: "moon-garden", name: "Moon Garden" })
  await page.setViewportSize(DESKTOP)
  await page.goto(`${SEEDED}/#/new`)
  await page.getByLabel("Pack name").fill("Moon Garden")
  await importFile(page, { name: "moon-garden.zip", mimeType: "application/zip", buffer: zip })
  await expect(page.getByRole("dialog")).toContainText("Importing saves this pack as a draft and opens it. Nothing is published.")
  await expect(page.getByRole("dialog")).not.toContainText("This file names the pack")
  await openReviewed(page)
  await expect(page).toHaveURL(/#\/packs\/moon-garden$/)
  await expect(page.getByRole("banner")).toContainText("Moon Garden · Draft")
  expect(await head(page, "moon-garden")).toMatchObject({ source: "draft" })
})

for (const [viewport, label] of [[DESKTOP, "desktop"], [PHONE, "phone"]] as const)
  test(`the footer with Create manually instead stays in view while scrolling, without covering content (${label})`, async ({ browser }) => {
    // Shorter than the page, so it scrolls at both sizes.
    const page = await (await browser.newContext({ viewport: { ...viewport, height: 700 } })).newPage()
    await page.goto(`${FRESH}/#/new`)
    const footer = page.getByRole("contentinfo")
    const manual = footer.getByRole("button", { name: "Create manually instead" })
    await expect(title(page)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)).toBe(true)
    const pinned = async () => {
      const box = (await footer.boundingBox())!
      expect(Math.abs(box.y + box.height - 700)).toBeLessThanOrEqual(1)
      await expect(manual).toBeInViewport()
    }
    // At the top, partway down and at the end of the page.
    await pinned()
    await page.mouse.wheel(0, 300)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
    await pinned()
    await page.getByRole("button", { name: "Advanced tools" }).click()
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await pinned()
    // The last of the content scrolls clear of the footer.
    const last = (await page.getByRole("button", { name: "View guide" }).boundingBox())!
    expect(last.y + last.height).toBeLessThanOrEqual((await footer.boundingBox())!.y)
    // What the viewport shows: full-page captures misplace sticky elements.
    await page.screenshot({ path: `test-results/evidence/create-footer-end-${label}.png` })
    // Keyboard focus is never hidden behind it: tab from the top through every control.
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.getByLabel("Pack name").focus()
    for (let i = 0; i < 20 && !(await manual.evaluate((el) => el === document.activeElement)); i++) {
      await page.keyboard.press("Tab")
      const focused = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement
        const box = el.getBoundingClientRect()
        return { name: el.textContent?.trim() ?? el.tagName, bottom: box.bottom, inFooter: !!el.closest("footer") }
      })
      if (!focused.inFooter) expect(focused.bottom, `${focused.name} above the footer`).toBeLessThanOrEqual((await footer.boundingBox())!.y + 1)
    }
    await expect(manual).toBeFocused()
    await page.evaluate(() => window.scrollTo(0, 250))
    // What the viewport shows: full-page captures misplace sticky elements.
    await page.screenshot({ path: `test-results/evidence/create-footer-scrolled-${label}.png` })
    await noOverflow(page)
    await axe(page, `sticky footer ${label}`)
  })

for (const [viewport, label] of [[DESKTOP, "desktop"], [PHONE, "phone"]] as const)
  test(`Advanced tools download the schema and template and show the import guide (${label})`, async ({ browser }) => {
    const page = await (await browser.newContext({ viewport })).newPage()
    await page.goto(`${FRESH}/#/new`)
    const toggle = page.getByRole("button", { name: "Advanced tools" })
    const tools = page.getByRole("list", { name: "Advanced tools" })
    // Collapsed by default.
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await expect(tools).toHaveCount(0)
    await toggle.click()
    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    await expect(page.getByText("For creating or editing pack files directly.")).toBeVisible()
    await expect(tools.getByRole("listitem")).toHaveText([
      /^Schema reference\s*Understand the structure and validation rules of a Trovekit content pack\.\s*Download schema$/,
      /^Blank pack template\s*Start with a ready-made JSON structure you can customize yourself\.\s*Download template$/,
      /^Import format guide\s*Learn how to prepare JSON files and ZIP archives containing card artwork\.\s*View guide$/,
    ])
    // The generic prompt is not offered here: the personalized Copy AI prompt replaces it.
    await expect(page.getByRole("button", { name: "Copy full-pack prompt" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Full-pack prompt and formats" })).toHaveCount(0)
    await noOverflow(page)
    await axe(page, `advanced tools ${label}`)
    await page.getByRole("button", { name: "View guide" }).scrollIntoViewIfNeeded()
    await shot(page, `advanced-${label}`)

    const read = async (button: string) => {
      const download = page.waitForEvent("download")
      await page.getByRole("button", { name: button }).click()
      const file = await download
      return { name: file.suggestedFilename(), json: JSON.parse(await (await import("node:fs/promises")).readFile((await file.path())!, "utf8")) }
    }
    const schema = await read("Download schema")
    expect(schema.name).toBe("trovekit-content-schema.json")
    expect(Object.keys(schema.json.properties)).toEqual(["pack", "rules"])
    const template = await read("Download template")
    expect(template.name).toBe("blank-pack.json")
    expect(template.json.pack).toMatchObject({ schemaVersion: 2, id: "my-pack", name: "My pack", cards: [] })
    expect(template.json.rules.schemaVersion).toBe(2)

    const view = page.getByRole("button", { name: "View guide" })
    await view.click()
    const guide = page.getByRole("dialog", { name: "Import format guide" })
    await expect(guide.getByRole("heading", { level: 3 })).toHaveText(["JSON pack files", "ZIP archives with card artwork", "When you import", "Adding cards in batches"])
    await expect(guide).toContainText('"schemaVersion": 2')
    await expect(guide).toContainText("Export with images")
    await expect(guide).toContainText("480 × 600 WebP")
    await expect(guide).toContainText("cost.<resource id>")
    await axe(page, `import guide ${label}`)
    await shot(page, `guide-${label}`)
    await page.keyboard.press("Escape")
    await expect(guide).toHaveCount(0)
    await expect(view).toBeFocused()
    // Collapsing hides the tools again.
    await toggle.click()
    await expect(tools).toHaveCount(0)
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(await packIds(page, FRESH)).toEqual([])
  })

for (const [viewport, label] of [[DESKTOP, "desktop"], [PHONE, "phone"]] as const)
  for (const scheme of ["light", "dark"] as const)
    test(`the creation page and empty library at ${label} in ${scheme}`, async ({ browser }) => {
      const page = await (await browser.newContext({ viewport, colorScheme: scheme })).newPage()
      await page.goto(`${FRESH}/#/library`)
      await expect(page.getByRole("heading", { name: "Create your first pack" })).toBeVisible()
      await noOverflow(page)
      await axe(page, `empty library ${label} ${scheme}`)
      await shot(page, `library-${label}-${scheme}`)
      await page.getByRole("link", { name: "Create pack" }).click()
      await expect(title(page)).toBeFocused()
      // Keyboard: name, description, the step actions, then the manual option.
      await page.keyboard.press("Tab")
      await expect(page.getByLabel("Pack name")).toBeFocused()
      await page.keyboard.press("Tab")
      await expect(page.getByLabel("Describe your game")).toBeFocused()
      await page.keyboard.press("Tab")
      await expect(page.getByRole("button", { name: "Copy AI prompt" })).toBeFocused()
      await page.keyboard.press("Tab")
      await expect(page.getByRole("button", { name: "Import pack file" })).toBeFocused()
      await page.keyboard.press("Tab")
      await expect(page.getByRole("button", { name: "Advanced tools" })).toBeFocused()
      await page.keyboard.press("Enter")
      await expect(page.getByRole("button", { name: "Download schema" })).toBeVisible()
      await page.keyboard.press("Enter")
      await page.getByRole("button", { name: "Create manually instead" }).focus()
      await noOverflow(page)
      await axe(page, `creation ${label} ${scheme}`)
      await shot(page, `page-${label}-${scheme}`)
    })

test("an import that reuses an installed pack's ID asks, and a separate pack takes the entered name", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  const before = await (await page.request.get(`${SEEDED}/admin-api/drafts/starfall`, { headers })).json()
  await page.goto(`${SEEDED}/#/library`)
  await adminNav(page, "New pack")
  await expect(page).toHaveURL(/#\/new$/)
  await page.getByLabel("Pack name").fill("Starfall Remix")
  await importFile(page, json(starfallContent()))
  await openReviewed(page)
  const choice = page.getByRole("dialog", { name: "Starfall Academy is already in your library" })
  // Nothing is saved until the admin chooses.
  expect(await (await page.request.get(`${SEEDED}/admin-api/drafts/starfall`, { headers })).json()).toEqual(before)
  await expect(choice).toContainText("The import uses the pack ID starfall.")
  await shot(page, "same-id")
  await choice.getByRole("button", { name: "Create separate pack" }).click()
  await expect(page).toHaveURL(/#\/packs\/starfall-remix$/)
  await expect(page.getByRole("banner")).toContainText("Starfall Remix · Draft")
  await expect(title(page)).toHaveText("Starfall Remix")
  // The installed pack is untouched.
  expect(await (await page.request.get(`${SEEDED}/admin-api/drafts/starfall`, { headers })).json()).toEqual(before)
  expect(await packIds(page, SEEDED)).toEqual(expect.arrayContaining(["starfall", "starfall-remix"]))
  await page.goBack()
  await expect(page).toHaveURL(/#\/library$/)
})

test("Create manually instead opens the new pack's Overview, and asks first when another pack has unsaved changes", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(`${SEEDED}/#/packs/starfall/rules`)
  await page.getByLabel("Target points").fill("31")
  // Opening the creation page keeps the editor as it is.
  await adminNav(page, "New pack")
  await expect(page.getByRole("alertdialog")).toHaveCount(0)
  await page.getByLabel("Pack name").fill("Garden Two")
  await page.getByRole("button", { name: "Create manually instead" }).click()
  const leave = page.getByRole("alertdialog")
  await expect(leave).toContainText("Save changes to Starfall Academy?")
  await leave.getByRole("button", { name: "Cancel" }).click()
  await expect(page.getByText("Nothing was created. Your changes are still open.")).toBeVisible()
  expect(await packIds(page, SEEDED)).not.toContain("garden-two")
  await page.getByRole("link", { name: "Back to Library" }).click()
  await adminNav(page, "Starfall Academy")
  await adminNav(page, "Rules")
  await expect(page.getByLabel("Target points")).toHaveValue("31")

  await adminNav(page, "New pack")
  await page.getByLabel("Pack name").fill("Garden Two")
  await page.getByRole("button", { name: "Create manually instead" }).click()
  await leave.getByRole("button", { name: "Discard changes" }).click()
  await expect(page).toHaveURL(/#\/packs\/garden-two$/)
  await expect(title(page)).toHaveText("Garden Two")
  await expect(page.getByRole("banner")).toContainText("Garden Two · Draft")
  await expect(page.getByRole("list", { name: "Setup steps" })).toContainText("Add cards: To do")
  expect(await packIds(page, SEEDED)).toContain("garden-two")
})

test("a pack file that finishes reading after the admin left the creation page is not opened", async ({ page }) => {
  const { zip } = await starfallBundle({ id: "late-garden", name: "Late Garden" })
  await page.setViewportSize(DESKTOP)
  await page.goto(`${SEEDED}/#/new`)
  await page.waitForLoadState("networkidle")
  let release!: () => void
  let arrived!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  const seen = new Promise<void>((resolve) => (arrived = resolve))
  await page.route("**/admin-api/bundle-import", async (route) => { arrived(); await gate; await route.continue() })
  await importFile(page, { name: "late-garden.zip", mimeType: "application/zip", buffer: zip })
  await seen
  await page.getByRole("link", { name: "Back to Library" }).click()
  await expect(title(page)).toHaveText("Library")
  const response = page.waitForResponse("**/admin-api/bundle-import")
  release()
  await response
  await expect(page.getByText("late-garden.zip was not opened because you moved on. Import it again.")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Review import" })).toHaveCount(0)
  await expect(page).toHaveURL(/#\/library$/)
  expect(await packIds(page, SEEDED)).not.toContain("late-garden")
})

test("the import review summarizes the pack, keeps its JSON under technical details and blocks invalid edits", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(`${SEEDED}/#/new`)
  await importFile(page, json(another("summary-pack", "Summary Pack", "Five elements, three years of study.")))
  const review = page.getByRole("dialog", { name: "Review import" })
  await expect(review.getByRole("heading", { name: "Summary Pack" })).toBeVisible()
  await expect(review).toContainText("Five elements, three years of study.")
  const contents = review.getByRole("definition")
  const { pack } = starfallContent()
  const count = (group: string) => pack.cards.filter((c) => c.group === group).length
  await expect(contents.nth(0)).toHaveText(`${pack.cards.length}${pack.cardGroups.map((g) => `${g.label}: ${count(g.id)}`).join("")}`)
  await expect(contents.nth(1)).toHaveText(pack.resourceKinds.map((k) => k.label).join(", "))
  await expect(contents.nth(2)).toHaveText(String(pack.achievements.length))
  await expect(contents.nth(3)).toHaveText(String(pack.relationships.length))
  // The JSON is there, but not by default.
  const details = review.getByRole("button", { name: "View technical details" })
  await expect(details).toHaveAttribute("aria-expanded", "false")
  await expect(review.getByLabel("Pack JSON")).toHaveCount(0)
  await expect(review.getByRole("switch")).toHaveCount(0)
  await expect(review.getByRole("button", { name: "Import", exact: true })).toBeInViewport()
  await details.click()
  await expect(review).toContainText("Pack ID summary-pack, version 1.0.0.")
  const raw = review.getByLabel("Pack JSON")
  const broken = another("summary-pack", "Summary Pack")
  broken.pack.relationships[0].cardIds[0] = "nobody"
  await raw.fill(JSON.stringify(broken))
  await expect(review.getByRole("button", { name: "Import", exact: true })).toBeDisabled()
  await expect(review).toContainText("Fix these fields in the technical details before importing.")
  await expect(review.getByRole("heading", { name: "Summary Pack" })).toHaveCount(0)
  // Corrected in place, the summary follows the JSON.
  await raw.fill(JSON.stringify(another("summary-pack", "Summary Pack Two")))
  await expect(review.getByRole("heading", { name: "Summary Pack Two" })).toBeVisible()
  await review.getByRole("button", { name: "Cancel" }).click()
  await expect(page).toHaveURL(/#\/new$/)
  expect(await packIds(page, SEEDED)).not.toContain("summary-pack")
})

for (const [viewport, label] of [[DESKTOP, "desktop"], [PHONE, "phone"]] as const)
  for (const scheme of ["light", "dark"] as const)
    test(`the import review reads clearly at ${label} in ${scheme}`, async ({ browser }) => {
      const page = await (await browser.newContext({ viewport, colorScheme: scheme })).newPage()
      await page.goto(`${SEEDED}/#/new`)
      await importFile(page, json(another("shown-pack", "Shown Pack", "Five elements, three years of study.")))
      const review = page.getByRole("dialog", { name: "Review import" })
      await expect(review.getByRole("heading", { name: "Shown Pack" })).toBeVisible()
      // The primary action is reachable without scrolling.
      await expect(review.getByRole("button", { name: "Import", exact: true })).toBeInViewport()
      await noOverflow(page)
      await axe(page, `import review ${label} ${scheme}`)
      await page.screenshot({ path: `test-results/evidence/create-import-review-${label}-${scheme}.png` })
      await review.getByRole("button", { name: "View technical details" }).click()
      await expect(review.getByLabel("Pack JSON")).toBeVisible()
      await axe(page, `import review details ${label} ${scheme}`)
      if (scheme === "light") await page.screenshot({ path: `test-results/evidence/create-import-details-${label}.png` })
    })

test("a draft that fails to save is not reported as imported, and Import can be tried again", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(`${SEEDED}/#/new`)
  await importFile(page, json(another("retry-pack", "Retry Pack")))
  const review = page.getByRole("dialog", { name: "Review import" })
  await expect(review.getByRole("heading", { name: "Retry Pack" })).toBeVisible()
  let failures = 1
  await page.route("**/admin-api/drafts", (route) => {
    if (route.request().method() !== "POST" || failures-- <= 0) return route.fallback()
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "The disk is full." }) })
  })
  await review.getByRole("button", { name: "Import", exact: true }).click()
  await expect(review.getByRole("alert")).toContainText("Retry Pack was not imported: The disk is full. Your file is still here, so you can try again.")
  await expect(page.getByText("Imported Retry Pack")).toHaveCount(0)
  await expect(page).toHaveURL(/#\/new$/)
  expect(await packIds(page, SEEDED)).not.toContain("retry-pack")
  await page.screenshot({ path: "test-results/evidence/create-import-failed.png" })
  // The same import, again: no new file needed.
  await review.getByRole("button", { name: "Import", exact: true }).click()
  await expect(page).toHaveURL(/#\/packs\/retry-pack$/)
  await expect(page.getByRole("banner")).toContainText("Retry Pack · Draft")
  expect(await head(page, "retry-pack")).toMatchObject({ source: "draft" })
})

test("an import saved after the admin left is kept but not opened", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(`${SEEDED}/#/library`)
  await adminNav(page, "New pack")
  await importFile(page, json(another("late-save", "Late Save")))
  await expect(page.getByRole("heading", { name: "Late Save" })).toBeVisible()
  await page.waitForLoadState("networkidle")
  let release!: () => void
  let arrived!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  const seen = new Promise<void>((resolve) => (arrived = resolve))
  await page.route("**/admin-api/drafts", async (route) => {
    if (route.request().method() !== "POST") return route.fallback()
    arrived(); await gate; await route.fallback()
  })
  await page.getByRole("button", { name: "Import", exact: true }).click()
  await seen
  await expect(page.getByRole("button", { name: "Importing…" })).toBeDisabled()
  await page.goBack()
  await expect(page).toHaveURL(/#\/library$/)
  const response = page.waitForResponse((r) => r.url().endsWith("/admin-api/drafts") && r.request().method() === "POST")
  release()
  await response
  await expect(page.getByText("Imported Late Save and saved it as a draft. Open it from the sidebar.")).toBeVisible()
  await expect(page).toHaveURL(/#\/library$/)
  await expect(title(page)).toHaveText("Library")
  await expect(page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Late Save", exact: true })).toBeVisible()
})

test("an import never discards unsaved edits without asking", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(`${SEEDED}/#/packs/starfall/rules`)
  await page.getByLabel("Target points").fill("33")
  await page.getByLabel("Import JSON file").setInputFiles(json(another("guarded-pack", "Guarded Pack")))
  await page.getByRole("button", { name: "Import", exact: true }).click()
  const leave = page.getByRole("alertdialog")
  await expect(leave).toContainText("Save changes to Starfall Academy?")
  await leave.getByRole("button", { name: "Cancel" }).click()
  await expect(page.getByRole("dialog", { name: "Review import" }).getByRole("alert")).toContainText("Nothing was imported. Your unsaved changes are still open.")
  expect(await packIds(page, SEEDED)).not.toContain("guarded-pack")
  await page.getByRole("dialog", { name: "Review import" }).getByRole("button", { name: "Cancel" }).click()
  await expect(page.getByLabel("Target points")).toHaveValue("33")
  await expect(page.getByRole("banner")).toContainText("Unsaved changes")
})

test("Update replaces the installed pack's draft only after a newer draft from elsewhere is confirmed", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(`${SEEDED}/#/packs/starfall`)
  await expect(page.getByRole("banner")).toContainText("Starfall Academy")
  const versions = (await (await page.request.get(`${SEEDED}/admin-api/content`, { headers })).json()).versions
  // Another tab saves a newer draft of the open pack.
  const opened = await head(page, "starfall")
  const elsewhere = structuredClone(opened.content)
  elsewhere.rules.targetPoints = 21
  expect((await (await page.request.post(`${SEEDED}/admin-api/drafts`, { headers, data: { content: elsewhere, revision: opened.revision } })).json()).ok).toBe(true)

  const imported = starfallContent()
  imported.rules.targetPoints = 12
  await page.getByLabel("Import JSON file").setInputFiles(json(imported))
  await page.getByRole("button", { name: "Import", exact: true }).click()
  const choice = page.getByRole("dialog", { name: "Starfall Academy is already in your library" })
  await choice.getByRole("button", { name: "Update Starfall Academy" }).click()
  await expect(choice.getByRole("alert")).toContainText("Starfall Academy changed in another tab or window since you opened it, so nothing was imported.")
  expect((await head(page, "starfall")).content.rules.targetPoints).toBe(21)
  await page.screenshot({ path: "test-results/evidence/create-import-newer-draft.png" })
  await choice.getByRole("button", { name: "Update Starfall Academy" }).click()
  await expect(choice).toHaveCount(0)
  await expect(page.getByRole("banner")).toContainText("Starfall Academy · Draft")
  expect(await head(page, "starfall")).toMatchObject({ source: "draft", content: { rules: { targetPoints: 12 } } })
  // Published versions are untouched.
  expect((await (await page.request.get(`${SEEDED}/admin-api/content`, { headers })).json()).versions).toEqual(versions)
  await page.reload()
  await adminNav(page, "Rules")
  await expect(page.getByLabel("Target points")).toHaveValue("12")
})

/** Holds every matching request, in arrival order, until the test handles it. */
async function queue(page: Page, url: string, method: string) {
  const held: Route[] = []
  await page.route(url, (route) => {
    if (route.request().method() !== method) return route.fallback()
    held.push(route)
  })
  return { held, arrived: (count: number) => expect.poll(() => held.length).toBe(count) }
}

test("an import being saved cannot be edited, and edits after a failed save are what is imported", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(`${SEEDED}/#/new`)
  await importFile(page, json(another("locked-pack", "Locked Pack")))
  const review = page.getByRole("dialog", { name: "Review import" })
  await review.getByRole("button", { name: "View technical details" }).click()
  const raw = review.getByLabel("Pack JSON")
  const submitted = await raw.inputValue()
  const saves = await queue(page, "**/admin-api/drafts", "POST")

  await review.getByRole("button", { name: "Import", exact: true }).click()
  await saves.arrived(1)
  await expect(review.getByRole("status")).toHaveText("Saving the draft…")
  await expect(review.getByRole("button", { name: "Importing…" })).toBeDisabled()
  await expect(review.getByRole("button", { name: "Cancel" })).toBeDisabled()
  await expect(raw).not.toBeEditable()
  await raw.focus()
  await page.keyboard.type("lost edit")
  await expect(raw).toHaveValue(submitted)
  await page.screenshot({ path: "test-results/evidence/create-import-saving.png" })

  // The save fails: editing comes back, with the same import.
  await saves.held[0].fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "The disk is full." }) })
  await expect(review.getByRole("alert")).toContainText("Locked Pack was not imported: The disk is full.")
  await expect(raw).toBeEditable()
  await expect(raw).toHaveValue(submitted)
  await raw.fill(JSON.stringify(another("locked-pack", "Locked Pack Edited")))
  await expect(review.getByRole("heading", { name: "Locked Pack Edited" })).toBeVisible()

  await review.getByRole("button", { name: "Import", exact: true }).click()
  await saves.arrived(2)
  await expect(raw).not.toBeEditable()
  expect(saves.held[1].request().postDataJSON().content.pack.name).toBe("Locked Pack Edited")
  await saves.held[1].fallback()
  await expect(page).toHaveURL(/#\/packs\/locked-pack$/)
  expect(await head(page, "locked-pack")).toMatchObject({ source: "draft", content: { pack: { name: "Locked Pack Edited" } } })
})

for (const [run, order] of (["the later file first", "the earlier file first"] as const).entries())
  test(`overlapping file reads show only the latest file, when ${order} finishes`, async ({ page }) => {
    const earlier = await starfallBundle({ id: `earlier-${run}`, name: "Earlier Pack" })
    const later = await starfallBundle({ id: `later-${run}`, name: "Later Pack" })
    await page.setViewportSize(DESKTOP)
    await page.goto(`${SEEDED}/#/new`)
    await expect(title(page)).toBeVisible()
    const reads = await queue(page, "**/admin-api/bundle-import", "POST")
    const input = page.getByLabel("Import JSON file")
    await input.setInputFiles({ name: "earlier.zip", mimeType: "application/zip", buffer: earlier.zip })
    await reads.arrived(1)
    await input.setInputFiles({ name: "later.zip", mimeType: "application/zip", buffer: later.zip })
    await reads.arrived(2)
    const review = page.getByRole("dialog", { name: "Review import" })
    const finish = async (index: number) => {
      const response = page.waitForResponse((r) => r.request() === reads.held[index].request())
      await reads.held[index].fallback()
      await response
    }
    if (order === "the later file first") {
      await finish(1)
      await expect(review.getByRole("heading", { name: "Later Pack" })).toBeVisible()
      await finish(0)
    } else {
      await finish(0)
      // The earlier file was superseded: nothing opens for it.
      await finish(1)
    }
    await expect(review.getByRole("heading", { name: "Later Pack" })).toBeVisible()
    await expect(review.getByRole("heading", { name: "Earlier Pack" })).toHaveCount(0)
    await review.getByRole("button", { name: "View technical details" }).click()
    expect(JSON.parse(await review.getByLabel("Pack JSON").inputValue()).pack.id).toBe(`later-${run}`)
    await expect(page.getByText(/was not opened because you moved on/)).toHaveCount(0)
    await review.getByRole("button", { name: "Import", exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`#/packs/later-${run}$`))
    expect(await packIds(page, SEEDED)).not.toContain(`earlier-${run}`)
  })

test("a file chosen while a review is open replaces it with its own content", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(`${SEEDED}/#/new`)
  const input = page.getByLabel("Import JSON file")
  await input.setInputFiles(json(another("first-file", "First File")))
  const review = page.getByRole("dialog", { name: "Review import" })
  await review.getByRole("button", { name: "View technical details" }).click()
  await review.getByLabel("Pack JSON").fill(JSON.stringify(another("first-file", "First File Edited")))
  await expect(review.getByRole("heading", { name: "First File Edited" })).toBeVisible()
  await input.setInputFiles(json(another("second-file", "Second File")))
  await expect(review.getByRole("heading", { name: "Second File" })).toBeVisible()
  // A fresh review: details closed again, and the JSON is the new file's, not the earlier edits.
  await expect(review.getByLabel("Pack JSON")).toHaveCount(0)
  await review.getByRole("button", { name: "View technical details" }).click()
  expect(JSON.parse(await review.getByLabel("Pack JSON").inputValue()).pack).toMatchObject({ id: "second-file", name: "Second File" })
  await review.getByRole("button", { name: "Cancel" }).click()
  expect(await packIds(page, SEEDED)).not.toContain("first-file")
})

test("the creation page explains draft, publish and default", async ({ page }) => {
  await page.goto(`${SEEDED}/#/new`)
  await expect(page.getByRole("list", { name: "Create with an AI assistant" })).toContainText("After a quick review, importing saves the pack as a private draft.")
  await expect(page.getByRole("list", { name: "Create with an AI assistant" })).toContainText("When it is ready, publish a version, then make that version the default so new game rooms use it.")
  await page.getByRole("button", { name: "Advanced tools" }).click()
  await page.getByRole("button", { name: "View guide" }).click()
  const guide = page.getByRole("dialog", { name: "Import format guide" })
  await expect(guide).toContainText("Importing saves the pack as a private draft. Publishing creates a version of it; making that version the default lets new game rooms use it.")
  await expect(guide).not.toContainText("Nothing is saved until")
})
