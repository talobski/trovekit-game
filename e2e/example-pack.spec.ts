import { expect, test, type Page } from "./browser-fixtures"
import { starfallBundle } from "../tests/fixtures/starfall"
import { adminNav, axe, DESKTOP, myTurn, noOverflow, PHONE, resultHeading, uiTurn } from "./helpers"
import { ISOLATED_PAIRS } from "./ports"

/*
 * A themed pack through the real UI: import a Starfall ZIP (as "Starfall
 * Expedition", next to the seeded fixture) in the private admin, publish it,
 * make it the default and play a whole game against a bot. Its own labels,
 * icons, artwork and the Motes crest must appear. Runs on its own server pair,
 * since it changes the default.
 */
const GAME = `http://localhost:${ISOLATED_PAIRS.expedition}`
const ADMIN = `http://127.0.0.1:${ISOLATED_PAIRS.expedition + 1}`

test.describe.configure({ mode: "serial" })

let bundle: Awaited<ReturnType<typeof starfallBundle>>
const labels = { acquire: "Bond", collect: "Gather", reserve: "Reserve" }

test.beforeAll(async () => {
  bundle = await starfallBundle({ id: "starfall-expedition", name: "Starfall Expedition" })
})

test("the admin imports and publishes the Starfall bundle", async ({ page }) => {
  await page.goto(ADMIN)
  await page.getByLabel("Import JSON file").setInputFiles({ name: "starfall.zip", mimeType: "application/zip", buffer: bundle.zip })
  await expect(page.getByRole("heading", { name: "Review import" })).toBeVisible()
  await page.getByRole("button", { name: "Import", exact: true }).click()
  await adminNav(page, "Settings")
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Starfall Expedition")
  await adminNav(page, "Resources")
  // The collection picture came with the bundle and is editable like any other field.
  await expect(page.getByRole("combobox", { name: "Resource picture" })).toHaveText("Uploaded image")
  await expect(page.getByLabel("Picture description")).toHaveValue("Starfall crest")
  await page.getByRole("button", { name: "Publish version" }).click()
  await page.getByRole("button", { name: "Publish", exact: true }).click()
  await expect(page.getByText("New rooms still use Starfall Academy. Make this version the default to switch.")).toBeVisible()
  await page.getByRole("button", { name: "Make default" }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
})

for (const [viewport, label] of [
  [PHONE, "phone"],
  [DESKTOP, "desktop"],
] as const) {
  test(`a full Starfall game against a bot (${label})`, async ({ browser }) => {
    test.setTimeout(400_000)
    const page = await (await browser.newContext({ viewport })).newPage()
    await page.goto(GAME)
    await page.getByLabel("Your name").fill("Ana")
    await page.getByRole("button", { name: "Create room" }).click()
    await page.waitForURL(/\/r\/[A-Z0-9]{6}$/)
    await page.getByRole("button", { name: "Add bot" }).click()
    await page.getByRole("button", { name: "Start game" }).click()
    await expect(page.getByRole("button", { name: "Game menu" })).toBeVisible()

    await checkTheme(page, label)

    const moves = { acquire: 0, collect: 0, reserve: 0, pass: 0 }
    for (let turn = 0; turn < 300; turn++) {
      await expect(myTurn(page).or(resultHeading(page))).toBeVisible({ timeout: 30_000 })
      if (await resultHeading(page).isVisible()) break
      moves[await uiTurn(page, labels)]++
    }
    await expect(resultHeading(page)).toBeVisible()
    await expect(page.getByRole("list", { name: "Final standings" }).getByRole("listitem")).toHaveCount(2)
    await page.screenshot({ path: `test-results/evidence/starfall-${label}-results.png`, fullPage: true })
    expect(moves.acquire).toBeGreaterThan(2)
    console.log(`Starfall (${label}): human moves ${JSON.stringify(moves)}; ${await page.getByRole("heading", { level: 1 }).textContent()}`)
  })
}

async function checkTheme(page: Page, label: string) {
  await expect(myTurn(page)).toBeVisible({ timeout: 30_000 })
  const main = page.locator("main")
  // Its own vocabulary, nothing from another theme.
  await expect(page.getByRole("button", { name: labels.collect, exact: true }).locator("visible=true")).toBeVisible()
  await expect(main.getByRole("img", { name: /^Ember in supply/ })).toBeVisible()
  const text = (await main.textContent())!.toLowerCase()
  for (const word of ["prospect", "superstar", "highflyer", "rebounder", "recruit"]) expect(text, word).not.toContain(word)
  // Card artwork from the bundle loads.
  const art = main.locator('img[src^="/art/managed/"]:visible').first()
  await expect(art).toBeVisible()
  expect(await art.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(480)

  // The supply key names every icon, by keyboard.
  const key = page.getByRole("button", { name: "Key", exact: true }).locator("visible=true")
  await key.focus()
  await page.keyboard.press("Enter")
  const legend = page.getByRole("dialog")
  for (const kind of ["Ember", "Tide", "Gale", "Stone", "Spark", "Starlight, counts as any kind"]) await expect(legend.getByText(kind, { exact: true })).toBeVisible()
  await axe(page, `starfall key ${label}`)
  await page.keyboard.press("Escape")
  await expect(legend).toBeHidden()
  await expect(key).toBeFocused()

  // The Motes crest backs each of the five Gather options; each still leads with its icon.
  await page.getByRole("button", { name: labels.collect, exact: true }).locator("visible=true").click()
  const sheet = page.getByRole("dialog")
  await expect(sheet.locator(`img[src="${bundle.content.pack.resourceArt!.src}"]`)).toHaveCount(5)
  await expect(sheet.locator("svg[viewBox='0 0 64 64']")).toHaveCount(0)
  await expect(sheet.getByText(/You hold 0 of 10 Motes/)).toBeVisible()
  await noOverflow(page)
  await axe(page, `starfall gather ${label}`)
  await page.screenshot({ path: `test-results/evidence/starfall-${label}-gather.png` })
  await page.keyboard.press("Escape")
  await expect(sheet).toBeHidden()
  await noOverflow(page)
  await axe(page, `starfall board ${label}`)
  await page.screenshot({ path: `test-results/evidence/starfall-${label}-board.png`, fullPage: true })
}
