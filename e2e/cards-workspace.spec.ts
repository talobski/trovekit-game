import type { Route } from "@playwright/test"
import { strToU8, zipSync } from "fflate"
import sharp from "sharp"
import { expect, test, type Page } from "./browser-fixtures"
import { starfallBundle, starfallContent } from "../tests/fixtures/starfall"
import { adminNav, axe, DESKTOP, noOverflow, PHONE } from "./helpers"
import { ISOLATED_PAIRS } from "./ports"

/*
 * The Cards workspace. A compact toolbar replaces the bulk section;
 * Generate cards with AI and Get images with AI copy pack-aware prompts; an
 * image ZIP with its source list imports straight into the cards, and players
 * see the credit at the bottom of card details. Runs on its own pair, since it
 * publishes and makes a version the default.
 */

test.describe.configure({ mode: "serial" })

const GAME = `http://localhost:${ISOLATED_PAIRS.cards}`
const ADMIN = `http://127.0.0.1:${ISOLATED_PAIRS.cards + 1}`
const headers = { "x-trovekit-admin": "1" }
const shot = (page: Page, name: string, fullPage = false) => page.screenshot({ path: `test-results/evidence/cards-${name}.png`, fullPage })
const png = (color: string) => sharp({ create: { width: 96, height: 120, channels: 3, background: color } }).png().toBuffer()
const zipFile = (name: string, files: Record<string, Uint8Array>) => ({ name, mimeType: "application/zip", buffer: Buffer.from(zipSync(files, { level: 0 })) })
const sourceList = (images: unknown[]) => strToU8(JSON.stringify({ format: "trovekit-card-images", version: 1, images }))
const credit = (cardId: string, extra: Record<string, string> = {}) => ({ cardId, source: `https://images.example.org/${cardId}`, creator: "Jane Smith", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", attribution: `“${cardId}” by Jane Smith`, modifications: "Cropped and resized by Trovekit", ...extra })
const draft = async (page: Page) => (await (await page.request.get(`${ADMIN}/admin-api/drafts/starfall`, { headers })).json()).content
const imageInput = (page: Page) => page.getByLabel("Bulk image files")

async function openCard(page: Page, name: string) {
  await page.getByLabel("Search cards").fill(name)
  await page.getByRole("list", { name: "Cards" }).getByRole("button", { name: new RegExp(name) }).click()
}

async function saveDraft(page: Page) {
  await expect(page.getByRole("banner")).toContainText("Unsaved changes")
  await page.getByRole("button", { name: "Save draft", exact: true }).click()
  await expect(page.getByRole("banner")).not.toContainText("Unsaved changes")
}

test("the Cards toolbar is compact and keeps every tool", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(`${ADMIN}/#/packs/starfall/cards`)
  const main = page.locator("main")
  for (const name of ["Add card", "Generate cards with AI", "Get images with AI", "Import images", "Import cards"]) await expect(main.getByRole("button", { name, exact: true })).toBeVisible()
  await expect(main.getByRole("button", { name: "Card IDs" })).toHaveCount(0)
  await expect(main.getByRole("heading", { name: /Create cards in bulk|Add your first cards/ })).toHaveCount(0)
  await expect(page.getByLabel("Filter by group")).toBeVisible()
  await expect(page.getByLabel("Search cards")).toBeVisible()
  // The card-ID manifest stays in Settings.
  await adminNav(page, "Settings")
  await expect(page.getByRole("button", { name: "Card-ID manifest" })).toBeVisible()
})

for (const [viewport, label] of [[DESKTOP, "desktop"], [PHONE, "phone"]] as const)
  for (const scheme of ["light", "dark"] as const)
    test(`the Cards page and its sheets read clearly at ${label} in ${scheme}`, async ({ browser }) => {
      const page = await (await browser.newContext({ viewport, colorScheme: scheme })).newPage()
      await page.goto(`${ADMIN}/#/packs/starfall/cards`)
      await expect(page.getByRole("list", { name: "Cards" })).toBeVisible()
      await noOverflow(page)
      await axe(page, `cards ${label} ${scheme}`)
      await page.getByRole("heading", { name: "All cards" }).scrollIntoViewIfNeeded()
      await page.evaluate(() => window.scrollBy(0, -80))
      await shot(page, `page-${label}-${scheme}`)
      for (const [button, sheet] of [["Generate cards with AI", "generate"], ["Get images with AI", "images"]] as const) {
        await page.getByRole("button", { name: button, exact: true }).click()
        const dialog = page.getByRole("dialog", { name: button })
        await expect(dialog).toBeVisible()
        await noOverflow(page)
        await axe(page, `${sheet} sheet ${label} ${scheme}`)
        await shot(page, `${sheet}-${label}-${scheme}`)
        await page.keyboard.press("Escape")
        await expect(dialog).toHaveCount(0)
        // Focus returns to the action that opened it.
        await expect(page.getByRole("button", { name: button, exact: true })).toBeFocused()
      }
    })

test("Generate cards with AI copies a pack-aware design prompt, and its batch imports for review", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ADMIN })
  await page.setViewportSize(DESKTOP)
  await page.goto(`${ADMIN}/#/packs/starfall/cards`)
  await page.getByRole("button", { name: "Generate cards with AI", exact: true }).click()
  const sheet = page.getByRole("dialog", { name: "Generate cards with AI" })
  await sheet.getByRole("button", { name: "Copy AI prompt" }).click()
  await expect(sheet.getByRole("status")).toHaveText("Prompt copied. Paste it into your AI assistant.")
  const prompt = await page.evaluate(() => navigator.clipboard.readText())
  for (const text of ['add cards to my content pack "Starfall Academy"', "PHASE 1: DISCOVER", "PHASE 2: DESIGN", "PHASE 3: GENERATE", "Write them only after I approve the plan", '"id": "aria-ashgrove"', "Use JSON unless I ask for CSV."]) expect(prompt).toContain(text)
  const { pack } = starfallContent()
  const batch = [
    { id: "nova-one", group: pack.cardGroups[0].id, name: "Nova One", permanentResource: pack.resourceKinds[0].id, points: pack.cardGroups[0].points.min, cost: { [pack.resourceKinds[1].id]: pack.cardGroups[0].cost.min } },
    { id: "nova-two", group: pack.cardGroups[0].id, name: "Nova Two", permanentResource: pack.resourceKinds[1].id, points: pack.cardGroups[0].points.min, cost: { [pack.resourceKinds[2].id]: pack.cardGroups[0].cost.min } },
  ]
  const chooser = page.waitForEvent("filechooser")
  await sheet.getByRole("button", { name: "Import cards" }).click()
  await (await chooser).setFiles({ name: "starfall-cards.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(batch)) })
  await expect(page.getByRole("heading", { name: "Review import" })).toBeVisible()
  await page.getByRole("switch", { name: "Apply this batch to my draft" }).click()
  await page.getByRole("button", { name: "Apply to editor" }).click()
  await expect(page.getByText("Cards applied. Review and save your draft when ready.")).toBeVisible()
  await page.getByLabel("Search cards").fill("Nova")
  await expect(page.getByRole("list", { name: "Cards" }).getByRole("button")).toHaveCount(2)
  await saveDraft(page)
})

test("Get images with AI covers cards without artwork by default, or all cards, or a group", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ADMIN })
  await page.setViewportSize(DESKTOP)
  await page.goto(`${ADMIN}/#/packs/starfall/cards`)
  await page.getByRole("button", { name: "Get images with AI", exact: true }).click()
  const sheet = page.getByRole("dialog", { name: "Get images with AI" })
  const target = sheet.getByRole("combobox", { name: "Cards to include" })
  await expect(target).toHaveText("Cards without artwork (2)")
  await expect(sheet).toContainText("2 cards included.")
  await sheet.getByRole("button", { name: "Copy AI prompt" }).click()
  let prompt = await page.evaluate(() => navigator.clipboard.readText())
  expect(prompt).toContain("These are the 2 cards that need an image.")
  expect(prompt).toContain("- nova-one: Nova One (")
  expect(prompt).not.toContain("- aria-ashgrove:")
  expect(prompt).toContain("trovekit-images.json")
  const { pack } = starfallContent()
  await target.click()
  await page.getByRole("option", { name: `All cards (${pack.cards.length + 2})` }).click()
  await expect(sheet).toContainText(`${pack.cards.length + 2} cards included.`)
  const group = pack.cardGroups[2]
  const inGroup = pack.cards.filter((c) => c.group === group.id).length
  await target.click()
  await page.getByRole("option", { name: `${group.label} (${inGroup})` }).click()
  await sheet.getByRole("button", { name: "Copy AI prompt" }).click()
  prompt = await page.evaluate(() => navigator.clipboard.readText())
  expect(prompt).toContain(`These are the ${inGroup} cards that need an image.`)
})

test("an image ZIP matches images and their sources to cards, and keeps existing artwork unless replacing", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(`${ADMIN}/#/packs/starfall/cards`)
  const original = (await draft(page)).pack.cards.find((c: { id: string }) => c.id === "aria-ashgrove").art
  await imageInput(page).setInputFiles(zipFile("images.zip", {
    "images/nova-one.png": await png("#336699"),
    "images/nova-two.jpg": await sharp(await png("#993366")).jpeg().toBuffer(),
    "images/aria-ashgrove.png": await png("#669933"),
    "images/ghost-card.png": await png("#999999"),
    "images/trovekit-images.json": sourceList([credit("nova-one"), credit("aria-ashgrove", { license: "CC BY-SA 4.0" }), credit("nobody"), { cardId: "nova-two", source: "http://insecure.example.org" }]),
  }))
  const review = page.getByRole("dialog", { name: "Review images" })
  await expect(review).toBeVisible()
  const row = (file: string) => review.getByRole("row").filter({ hasText: file })
  await expect(row("nova-one.png")).toContainText("Matched")
  await expect(row("nova-one.png")).toContainText("Jane Smith · CC BY 4.0 · source linked")
  await expect(row("nova-two.jpg")).toContainText("No source details")
  await expect(row("aria-ashgrove.png")).toContainText("Already has image")
  await expect(row("ghost-card.png")).toContainText("No card with this ID")
  const notes = review.getByRole("list", { name: "Import notes" })
  await expect(notes).toContainText("The source list describes nobody, but the ZIP has no image for it.")
  await expect(notes).toContainText("Source entry 4 (nova-two): source: Use an HTTPS source URL")
  await expect(review).toContainText("Trovekit has not checked them")
  await noOverflow(page)
  await axe(page, "image zip review")
  await shot(page, "zip-review")
  await review.getByRole("button", { name: "Apply valid matches" }).click()
  await expect(page.getByText("Applied 2 images to the editor")).toBeVisible()
  await saveDraft(page)
  let cards = (await draft(page)).pack.cards
  const find = (id: string) => cards.find((c: { id: string }) => c.id === id).art
  expect(find("aria-ashgrove")).toEqual(original)
  expect(find("nova-one")).toMatchObject({ creator: "Jane Smith", license: "CC BY 4.0", source: "https://images.example.org/nova-one", attribution: "“nova-one” by Jane Smith Changes: Cropped and resized by Trovekit" })
  expect(find("nova-two")).toEqual({ src: expect.stringMatching(/^\/art\/managed\//), alt: "Nova Two" })
  // The imported details are editable like any other.
  await openCard(page, "Nova One")
  await expect(page.getByLabel("Creator / rights holder")).toHaveValue("Jane Smith")
  await expect(page.getByLabel("License / permission")).toHaveValue("CC BY 4.0")
  await page.keyboard.press("Escape")

  // Replacing: the new image brings only its own details.
  await imageInput(page).setInputFiles(zipFile("again.zip", { "aria-ashgrove.png": await png("#225588"), "trovekit-images.json": sourceList([credit("aria-ashgrove", { license: "CC BY-SA 4.0" })]) }))
  await review.getByRole("switch", { name: "Replace existing images in this batch" }).click()
  await review.getByRole("button", { name: "Apply valid matches" }).click()
  await saveDraft(page)
  cards = (await draft(page)).pack.cards
  expect(find("aria-ashgrove")).toMatchObject({ creator: "Jane Smith", license: "CC BY-SA 4.0" })
  expect(find("aria-ashgrove").src).not.toBe(original.src)
  expect(find("aria-ashgrove").restrictions).toBeUndefined()
})

test("unsafe ZIPs and complete pack files are refused, and loose images still import", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(`${ADMIN}/#/packs/starfall/cards`)
  await imageInput(page).setInputFiles(zipFile("bad.zip", { "../escape.png": await png("#000000") }))
  await expect(page.getByText(/Unsafe path in the ZIP/)).toBeVisible()
  const bundle = await starfallBundle()
  await imageInput(page).setInputFiles({ name: "pack.zip", mimeType: "application/zip", buffer: bundle.zip })
  await expect(page.getByText(/This is a complete pack file, not card images/)).toBeVisible()
  await imageInput(page).setInputFiles([zipFile("a.zip", {}), { name: "nova-one.png", mimeType: "image/png", buffer: await png("#123456") }])
  await expect(page.getByText("Choose one ZIP, or images without a ZIP.")).toBeVisible()
  await expect(page.getByRole("dialog", { name: "Review images" })).toHaveCount(0)
  await imageInput(page).setInputFiles([{ name: "nova-two.png", mimeType: "image/png", buffer: await png("#654321") }])
  const review = page.getByRole("dialog", { name: "Review images" })
  await expect(review.getByRole("row").filter({ hasText: "nova-two.png" })).toContainText("Already has image")
  await review.getByRole("switch", { name: "Replace existing images in this batch" }).click()
  await review.getByRole("button", { name: "Apply valid matches" }).click()
  await expect(page.getByText("Applied 1 image to the editor")).toBeVisible()
})

test("artwork changed while an image ZIP is being read is kept", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(`${ADMIN}/#/packs/starfall/cards`)
  await page.getByRole("button", { name: "Add card", exact: true }).click()
  const id = await page.getByLabel("Id", { exact: true }).inputValue()
  await page.keyboard.press("Escape")
  await saveDraft(page)
  await page.waitForLoadState("networkidle")
  let held!: Route
  let arrived!: () => void
  const seen = new Promise<void>((resolve) => (arrived = resolve))
  await page.route("**/admin-api/image-zip", (route) => { held = route; arrived() })
  await imageInput(page).setInputFiles(zipFile("late.zip", { [`${id}.png`]: await png("#aa5500"), "trovekit-images.json": sourceList([credit(id)]) }))
  await seen
  // Meanwhile the admin uploads an image for that card by hand.
  await openCard(page, id)
  await page.getByLabel("Card image file", { exact: true }).setInputFiles({ name: `${id}.png`, mimeType: "image/png", buffer: await png("#0055aa") })
  await expect(page.getByRole("button", { name: "Replace image" })).toBeVisible()
  await page.getByLabel("Creator / rights holder").fill("Me")
  await page.keyboard.press("Escape")
  await held.fallback()
  const review = page.getByRole("dialog", { name: "Review images" })
  await expect(review.getByRole("row").filter({ hasText: `${id}.png` })).toContainText("Matched")
  await review.getByRole("button", { name: "Apply valid matches" }).click()
  await expect(page.getByText("Applied 0 images. 1 card's artwork changed while you were reviewing, so it was kept.")).toBeVisible()
  await saveDraft(page)
  const art = (await draft(page)).pack.cards.find((c: { id: string }) => c.id === id).art
  expect(art).toMatchObject({ creator: "Me" })
  expect(art.license).toBeUndefined()
  // Leave the pack publishable: the extra card goes again.
  await openCard(page, id)
  await page.getByRole("button", { name: "Delete card" }).click()
  await saveDraft(page)
})

/** Holds image uploads in arrival order until the test lets each one through. */
async function holdUploads(page: Page) {
  await page.waitForLoadState("networkidle")
  const held: Route[] = []
  await page.route("**/admin-api/assets?*", (route) => { if (route.request().method() === "POST") held.push(route); else return route.fallback() })
  return { held, arrived: (n: number) => expect.poll(() => held.length).toBe(n) }
}
const novaArt = async (page: Page) => (await draft(page)).pack.cards.find((c: { id: string }) => c.id === "nova-one").art

test("a single-card upload that finishes after the card was closed is not applied", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(`${ADMIN}/#/packs/starfall/cards`)
  const before = await novaArt(page)
  const uploads = await holdUploads(page)
  await openCard(page, "Nova One")
  await page.getByLabel("Card image file", { exact: true }).setInputFiles({ name: "nova-one.png", mimeType: "image/png", buffer: await png("#aa0000") })
  await uploads.arrived(1)
  await expect(page.getByRole("button", { name: "Uploading…" })).toBeDisabled()
  await page.keyboard.press("Escape")
  const response = page.waitForResponse((r) => r.request() === uploads.held[0].request())
  await uploads.held[0].fallback()
  await response
  // The card keeps its artwork and details.
  await openCard(page, "Nova One")
  await expect(page.getByLabel("Creator / rights holder")).toHaveValue("Jane Smith")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("banner")).not.toContainText("Unsaved changes")
  expect(await novaArt(page)).toEqual(before)
  await expect(page.getByText("The image for Nova One finished uploading after you closed the card or chose another image, so it was not applied.")).toBeVisible()
})

test("a newer upload and its details win over an older upload of the same card that finishes later", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(`${ADMIN}/#/packs/starfall/cards`)
  const uploads = await holdUploads(page)
  await openCard(page, "Nova One")
  await page.getByLabel("Card image file", { exact: true }).setInputFiles({ name: "nova-one.png", mimeType: "image/png", buffer: await png("#aa0000") })
  await uploads.arrived(1)
  // Close, reopen the same card and upload a newer image, which finishes first.
  await page.keyboard.press("Escape")
  await openCard(page, "Nova One")
  await page.getByLabel("Card image file", { exact: true }).setInputFiles({ name: "nova-one.png", mimeType: "image/png", buffer: await png("#00aa00") })
  await uploads.arrived(2)
  const newer = page.waitForResponse((r) => r.request() === uploads.held[1].request())
  await uploads.held[1].fallback()
  const newerSrc = (await (await newer).json()).src
  await expect(page.getByRole("button", { name: "Replace image" })).toBeEnabled()
  await page.getByLabel("Creator / rights holder").fill("Newer creator")
  // Now the older upload finishes.
  const older = page.waitForResponse((r) => r.request() === uploads.held[0].request())
  await uploads.held[0].fallback()
  await older
  await expect(page.getByLabel("Creator / rights holder")).toHaveValue("Newer creator")
  await expect(page.getByText(/finished uploading after you closed the card or chose another image/)).toBeVisible()
  await page.keyboard.press("Escape")
  await saveDraft(page)
  expect(await novaArt(page)).toEqual({ src: newerSrc, alt: "Nova One", creator: "Newer creator" })
})

test("an upload does not replace artwork whose details were edited while it was uploading", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(`${ADMIN}/#/packs/starfall/cards`)
  const before = await novaArt(page)
  const uploads = await holdUploads(page)
  await openCard(page, "Nova One")
  await page.getByLabel("Card image file", { exact: true }).setInputFiles({ name: "nova-one.png", mimeType: "image/png", buffer: await png("#0000aa") })
  await uploads.arrived(1)
  await page.getByLabel("Creator / rights holder").fill("Edited meanwhile")
  const response = page.waitForResponse((r) => r.request() === uploads.held[0].request())
  await uploads.held[0].fallback()
  await response
  await expect(page.getByLabel("Creator / rights holder")).toHaveValue("Edited meanwhile")
  await expect(page.getByText("The image for Nova One finished uploading after its artwork changed, so it was not applied.")).toBeVisible()
  await page.keyboard.press("Escape")
  await saveDraft(page)
  expect(await novaArt(page)).toEqual({ ...before, creator: "Edited meanwhile" })
})

test("a normal single-card upload replaces the image and its details", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(`${ADMIN}/#/packs/starfall/cards`)
  await openCard(page, "Nova One")
  const response = page.waitForResponse((r) => r.url().includes("/admin-api/assets") && r.request().method() === "POST")
  await page.getByLabel("Card image file", { exact: true }).setInputFiles({ name: "nova-one.png", mimeType: "image/png", buffer: await png("#777700") })
  const src = (await (await response).json()).src
  await expect(page.getByRole("button", { name: "Replace image" })).toBeEnabled()
  // The new image brings no details from the previous one.
  await expect(page.getByLabel("Creator / rights holder")).toHaveValue("")
  await page.keyboard.press("Escape")
  await saveDraft(page)
  expect(await novaArt(page)).toEqual({ src, alt: "Nova One" })
})

const resourcePicture = async (page: Page) => (await draft(page)).pack.resourceArt
const pictureFile = (page: Page) => page.getByLabel("Resource picture file", { exact: true })
const description = (page: Page) => page.getByLabel("Picture description")

test("a resource picture upload that finishes after leaving Resources is not applied", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(`${ADMIN}/#/packs/starfall/resources`)
  const before = await resourcePicture(page)
  const uploads = await holdUploads(page)
  await pictureFile(page).setInputFiles({ name: "crest.png", mimeType: "image/png", buffer: await png("#aa0000") })
  await uploads.arrived(1)
  await adminNav(page, "Cards")
  const response = page.waitForResponse((r) => r.request() === uploads.held[0].request())
  await uploads.held[0].fallback()
  await response
  // Nothing changed in the editor or the saved draft.
  await adminNav(page, "Resources")
  await expect(page.getByRole("banner")).not.toContainText("Unsaved changes")
  await expect(description(page)).toHaveValue(before.alt)
  expect(await resourcePicture(page)).toEqual(before)
  await expect(page.getByText("The resource picture finished uploading after you left the page or chose another image, so it was not applied.")).toBeVisible()
})

test("a newer resource picture and its description win over an older upload that finishes later", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(`${ADMIN}/#/packs/starfall/resources`)
  const uploads = await holdUploads(page)
  await pictureFile(page).setInputFiles({ name: "crest.png", mimeType: "image/png", buffer: await png("#aa0000") })
  await uploads.arrived(1)
  await pictureFile(page).setInputFiles({ name: "crest.png", mimeType: "image/png", buffer: await png("#00aa00") })
  await uploads.arrived(2)
  const newer = page.waitForResponse((r) => r.request() === uploads.held[1].request())
  await uploads.held[1].fallback()
  const newerSrc = (await (await newer).json()).src
  await expect(page.getByRole("button", { name: "Replace image" })).toBeEnabled()
  await description(page).fill("Newer description")
  const older = page.waitForResponse((r) => r.request() === uploads.held[0].request())
  await uploads.held[0].fallback()
  await older
  await expect(description(page)).toHaveValue("Newer description")
  await expect(page.getByText(/resource picture finished uploading after you left the page or chose another image/)).toBeVisible()
  await saveDraft(page)
  expect(await resourcePicture(page)).toEqual({ src: newerSrc, alt: "Newer description" })
})

test("a resource picture upload does not replace a picture whose description changed meanwhile, and normal uploads work", async ({ page }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(`${ADMIN}/#/packs/starfall/resources`)
  const before = await resourcePicture(page)
  const uploads = await holdUploads(page)
  await pictureFile(page).setInputFiles({ name: "crest.png", mimeType: "image/png", buffer: await png("#0000aa") })
  await uploads.arrived(1)
  await description(page).fill("Edited meanwhile")
  const response = page.waitForResponse((r) => r.request() === uploads.held[0].request())
  await uploads.held[0].fallback()
  await response
  await expect(description(page)).toHaveValue("Edited meanwhile")
  await expect(page.getByText("The resource picture finished uploading after the picture changed, so it was not applied.")).toBeVisible()
  await saveDraft(page)
  expect(await resourcePicture(page)).toEqual({ ...before, alt: "Edited meanwhile" })
  // A normal upload replaces the picture and keeps its description.
  await page.unrouteAll({ behavior: "ignoreErrors" })
  const upload = page.waitForResponse((r) => r.url().includes("/admin-api/assets") && r.request().method() === "POST")
  await pictureFile(page).setInputFiles({ name: "crest.png", mimeType: "image/png", buffer: await png("#555555") })
  const src = (await (await upload).json()).src
  await expect(page.getByRole("button", { name: "Replace image" })).toBeEnabled()
  await saveDraft(page)
  expect(await resourcePicture(page)).toEqual({ src, alt: "Edited meanwhile" })
})

test("players see imported image credits at the bottom of card details", async ({ page, browser }) => {
  await page.setViewportSize(DESKTOP)
  await page.goto(`${ADMIN}/#/packs/starfall/cards`)
  // Credits for every card in the draft, so whichever card is in the market has one.
  const cards: { id: string }[] = (await draft(page)).pack.cards
  const files: Record<string, Uint8Array> = {}
  for (const c of cards) files[`${c.id}.png`] = await png("#335577")
  files["trovekit-images.json"] = sourceList(cards.map((c) => credit(c.id)))
  await imageInput(page).setInputFiles(zipFile("all.zip", files))
  const review = page.getByRole("dialog", { name: "Review images" })
  await review.getByRole("switch", { name: "Replace existing images in this batch" }).click()
  await review.getByRole("button", { name: "Apply valid matches" }).click()
  await page.getByRole("button", { name: "Publish version" }).click()
  await page.getByRole("button", { name: "Publish", exact: true }).click()
  await page.getByRole("button", { name: "Make default" }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)

  for (const [viewport, label] of [[DESKTOP, "desktop"], [PHONE, "phone"]] as const)
    for (const scheme of ["light", "dark"] as const) {
      const game = await (await browser.newContext({ viewport, colorScheme: scheme })).newPage()
      await game.goto(GAME)
      await game.getByLabel("Your name").fill("Credits")
      await game.getByRole("button", { name: "Create room" }).click()
      await game.getByRole("button", { name: "Add bot" }).click()
      await game.getByRole("button", { name: "Start game" }).click()
      await game.locator("main section button[aria-label*='Cost']:visible").first().click()
      const details = game.getByRole("dialog")
      const credits = details.getByRole("region", { name: "Image credit" })
      await expect(credits).toContainText("Image: Jane Smith · Source · CC BY 4.0")
      await expect(credits).toContainText("by Jane Smith Changes: Cropped and resized by Trovekit")
      await expect(credits.getByRole("link", { name: "Source" })).toHaveAttribute("href", /^https:\/\/images\.example\.org\//)
      await expect(credits.getByRole("link", { name: "CC BY 4.0" })).toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/")
      await expect(credits).not.toContainText(/verified/i)
      // Last in the details, after the gameplay information.
      const order = await details.evaluate((el) => {
        const all = [...el.querySelectorAll("dl, section[aria-label='Image credit']")]
        return all.map((n) => n.tagName)
      })
      expect(order.at(-1)).toBe("SECTION")
      // Reachable by keyboard.
      await credits.getByRole("link", { name: "Source" }).focus()
      await expect(credits.getByRole("link", { name: "Source" })).toBeFocused()
      await credits.scrollIntoViewIfNeeded()
      await noOverflow(game)
      await axe(game, `card credit ${label} ${scheme}`)
      await game.screenshot({ path: `test-results/evidence/cards-game-credit-${label}-${scheme}.png` })
      await game.context().close()
    }
})
