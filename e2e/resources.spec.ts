import { expect, test } from "./browser-fixtures"
import { adminNav, axe, DESKTOP, FIXTURE, myTurn, noOverflow, PHONE } from "./helpers"

/** Starfall's resource kinds, in order, and the icons the UI draws for them. */
const KINDS = ["Ember", "Tide", "Gale", "Stone", "Spark"]
const ICONS = ["flame", "droplet", "wind", "mountain", "zap"]

for (const width of [390, 1280]) test(`resource editor and icons at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  await page.goto("http://127.0.0.1:5281")
  await adminNav(page, "Settings")
  await expect(page.getByLabel("Resources (many)")).toHaveValue(FIXTURE.resources)
  await page.getByLabel("Resources (many)").fill("Sparks")
  await adminNav(page, "Resources")
  await expect(page.getByRole("heading", { name: "Resources", exact: true, level: 1 })).toBeVisible()
  await expect(page.getByLabel("Label (spark)", { exact: true })).toHaveValue("Spark")
  // Icons are chosen per kind; each kind needs its own.
  await expect(page.getByRole("combobox", { name: "Icon" }).first()).toHaveText(/flame/)
  // Resource picture: a shadcn Select, operable by keyboard; "None" removes it.
  const picture = page.getByRole("combobox", { name: "Resource picture" })
  await expect(picture).toHaveText("Uploaded image")
  await expect(page.getByRole("button", { name: "Replace image" })).toBeVisible()
  await expect(page.getByLabel("Picture description")).toHaveValue("Starfall crest")
  await noOverflow(page)
  await axe(page, `resource editor ${width}`)
  await picture.focus()
  await page.keyboard.press("Enter")
  await page.getByRole("option", { name: "None" }).press("Enter")
  await expect(picture).toHaveText("None")
  await expect(picture).toBeFocused()
  await adminNav(page, "Preview")
  for (const icon of ICONS) await expect(page.locator(`svg.lucide-${icon}`).first()).toBeVisible()
  await noOverflow(page)
  await axe(page, "resource preview")
})

for (const [viewport, label] of [
  [PHONE, "phone"],
  [DESKTOP, "desktop"],
] as const) test(`collect options use the pack's picture and icons explain themselves (${label})`, async ({ browser }) => {
  const page = await (await browser.newContext({ viewport })).newPage()
  await page.goto("/")
  await page.getByLabel("Your name").fill("Ana")
  await page.getByRole("button", { name: "Create room" }).click()
  await page.waitForURL(/\/r\/[A-Z0-9]{6}$/)
  await page.getByRole("button", { name: "Add bot" }).click()
  await page.getByRole("button", { name: "Start game" }).click()
  await expect(myTurn(page).or(page.getByText("Bot 1's turn"))).toBeVisible()

  // Hovering a supply chip shows the same words a screen reader hears.
  const chip = page.locator("main").getByRole("img", { name: /^Ember in supply/ }).locator("visible=true")
  await chip.hover()
  await expect(page.getByRole("tooltip")).toHaveText(/^Ember in supply: \d+$/)
  await page.mouse.move(0, 0)

  // The key works by keyboard and returns focus.
  const key = page.getByRole("button", { name: "Key", exact: true }).locator("visible=true")
  await key.focus()
  await page.keyboard.press("Enter")
  for (const kind of KINDS) await expect(page.getByRole("dialog").getByText(kind, { exact: true })).toBeVisible()
  await page.getByRole("dialog").screenshot({ path: `test-results/ui-review/key-${label}.png` })
  await page.keyboard.press("Escape")
  await expect(key).toBeFocused()

  // A pointer resting on a card's bottom edge must not make it flicker (it used to lift on hover).
  const card = page.locator("main section button[aria-label*='Cost']:visible").first()
  const box = (await card.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 1)
  await page.waitForTimeout(300)
  expect(await card.boundingBox()).toEqual(box)
  await expect(card).toHaveCSS("transform", "none")
  await page.mouse.move(0, 0)

  await expect(myTurn(page)).toBeVisible({ timeout: 30_000 })
  const callout = page.getByRole("region", { name: FIXTURE.collect, exact: true })
  for (const icon of ICONS) await expect(callout.locator(`svg.lucide-${icon}`)).toHaveCount(1)
  await page.getByRole("button", { name: FIXTURE.collect, exact: true }).locator("visible=true").click()
  const sheet = page.getByRole("dialog")
  // The pack's collection picture backs each of the five options; the holding line has no picture.
  const picture = sheet.locator('img[src^="/art/managed/"]')
  await expect(picture).toHaveCount(5)
  for (const img of await picture.all()) await expect(img).toHaveJSProperty("naturalWidth", 480)
  const holding = sheet.getByText(new RegExp(`You hold 0 of 10 ${FIXTURE.resources}`))
  await expect(holding).toBeVisible()
  await expect(holding.locator("img")).toHaveCount(0)
  for (const kind of KINDS) await expect(sheet.getByRole("button", { name: new RegExp(`^${kind}, \\d+ in supply`) })).toBeVisible()
  for (const icon of ICONS) await expect(sheet.locator(`button svg.lucide-${icon}`)).toHaveCount(1)
  await noOverflow(page)
  await axe(page, `collect sheet ${label}`)
  await page.screenshot({ path: `test-results/evidence/collect-${label}.png` })
  const kinds = sheet.locator('button[aria-label*="in supply"]:not([disabled])')
  for (let i = 0; i < Math.min(3, await kinds.count()); i++) await kinds.nth(i).click()
  const confirm = sheet.getByRole("button", { name: new RegExp(`^${FIXTURE.collect} .+`) })
  await expect(confirm).toBeEnabled()
  expect(await confirm.evaluate((button) => button.scrollWidth <= button.clientWidth)).toBe(true)
  await noOverflow(page)
})
