import { expect, test, type Page } from "./browser-fixtures"
import { adminNav, axe, DESKTOP, noOverflow, openRoomUi, PHONE } from "./helpers"

const ADMIN = "http://127.0.0.1:5281"

async function openRelationship(page: Page, label: RegExp) {
  await page.goto(ADMIN)
  await adminNav(page, "Relationships")
  await page.getByRole("button", { name: label }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
}

test.describe("relationships combobox", () => {
  test("desktop: search, keyboard selection, focus return and selected state", async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: DESKTOP })).newPage()
    await openRelationship(page, /Aria Ashgrove and Bram Ashgrove/)
    const card2 = page.getByRole("combobox", { name: "Card 2" })
    await expect(card2).toHaveText("Bram Ashgrove")
    await expect(card2).toHaveAttribute("aria-expanded", "false")

    // Keyboard opens it; focus lands in the search field. While open, the page behind is
    // hidden from assistive tech (modal popover), so check the trigger by id.
    await card2.focus()
    await page.keyboard.press("Enter")
    await expect(page.locator("#rel-card-1")).toHaveAttribute("aria-expanded", "true")
    const search = page.getByPlaceholder("Search cards")
    await expect(search).toBeFocused()

    // The current choice is marked and highlighted.
    await expect(page.getByRole("option", { name: "Bram Ashgrove (selected)" })).toHaveAttribute("aria-selected", "true")
    await axe(page, "combobox-open-desktop")

    // Escape closes without changing anything and returns focus to the trigger.
    await page.keyboard.press("Escape")
    await expect(card2).toHaveAttribute("aria-expanded", "false")
    await expect(card2).toBeFocused()
    await expect(page.getByRole("dialog")).toBeVisible()

    // Search narrows the list; arrow keys move; Enter picks.
    await page.keyboard.press("Enter")
    await search.fill("vesna")
    const options = page.getByRole("option")
    await expect(options).toHaveText(["Vesna Ashgrove", "Vesna Brightwater", "Vesna Coldspire"])
    await page.keyboard.press("ArrowDown")
    await expect(page.getByRole("option", { name: "Vesna Brightwater" })).toHaveAttribute("aria-selected", "true")
    await page.keyboard.press("Enter")
    await expect(card2).toHaveText("Vesna Brightwater")
    await expect(card2).toBeFocused()

    // No matches.
    await card2.click()
    await search.fill("zzzz")
    await expect(page.getByText("No card with that name")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(card2).toHaveAttribute("aria-expanded", "false")
    await expect(card2).toHaveText("Vesna Brightwater")

    // Existing behaviour: the edit lands in the relationship and shows up as a change.
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toBeHidden()
    await expect(page.getByRole("button", { name: /Aria Ashgrove and Bram Ashgrove/ })).toContainText("Aria Ashgrove, Vesna Brightwater")
    await adminNav(page, "Versions")
    await expect(page.getByText('cardIds: ["aria-ashgrove","bram-ashgrove"] → ["aria-ashgrove","vesna-brightwater"]')).toBeVisible()
  })

  test("desktop: duo becomes a trio and the third card is searchable", async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: DESKTOP })).newPage()
    await openRelationship(page, /Cass Ashgrove and Dorian Ashgrove/)
    await page.getByRole("button", { name: "Make it a trio" }).click()
    const card3 = page.getByRole("combobox", { name: "Card 3" })
    await card3.click()
    await page.getByPlaceholder("Search cards").fill("nobody")
    await expect(page.getByRole("option")).toHaveCount(0)
    await page.getByPlaceholder("Search cards").fill("kael")
    await page.getByRole("option", { name: "Kael Brightwater" }).click()
    await expect(card3).toHaveText("Kael Brightwater")
    await page.getByRole("button", { name: "Make it a duo" }).click()
    await expect(page.getByRole("combobox", { name: "Card 3" })).toHaveCount(0)
  })

  test("phone: the list opens in a drawer with touch-sized options", async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: PHONE, hasTouch: true })).newPage()
    await openRelationship(page, /Aria Ashgrove and Bram Ashgrove/)
    const card1 = page.getByRole("combobox", { name: "Card 1" })
    await card1.tap()
    const drawer = page.getByRole("dialog", { name: "Card 1" })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByPlaceholder("Search cards")).toBeFocused()
    await drawer.getByPlaceholder("Search cards").fill("tamsin")
    const option = drawer.getByRole("option", { name: "Tamsin Coldspire" })
    const box = await option.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(40)
    await noOverflow(page)
    await axe(page, "combobox-open-phone")
    await option.tap()
    await expect(drawer).toBeHidden()
    await expect(card1).toHaveText("Tamsin Coldspire")
    // The relationship editor is still open underneath.
    await expect(page.getByRole("dialog", { name: /Aria Ashgrove and Bram Ashgrove/ })).toBeVisible()
  })
})

test.describe("selects", () => {
  for (const viewport of [PHONE, DESKTOP]) {
    test(`short lists use Select, by pointer and keyboard (${viewport.width}px)`, async ({ browser }) => {
      const page = await (await browser.newContext({ viewport })).newPage()
      await page.goto(ADMIN)

      // Rules: tie-break by pointer.
      await adminNav(page, "Rules")
      await expect(page.getByLabel("Unique cards per player")).toHaveCount(0)
      await expect(page.getByLabel("Face-up unique cards")).toHaveCount(0)
      const tieBreak = page.getByRole("combobox", { name: "Tie-break" })
      await expect(tieBreak).toHaveText("Fewest acquired cards, then shared")
      await tieBreak.click()
      await expect(page.getByRole("option", { name: "Fewest acquired cards, then shared" })).toHaveAttribute("data-state", "checked")
      // Focus stays in the open list: Tab cannot reach the hidden page.
      await page.keyboard.press("Tab")
      expect(await page.evaluate(() => !!document.activeElement?.closest("[role=listbox]"))).toBe(true)
      await axe(page, "select-open", { openListbox: true })
      await page.getByRole("option", { name: "Shared", exact: true }).click()
      await expect(tieBreak).toHaveText("Shared")
      await expect(page.getByText("Unsaved changes")).toBeVisible()

      // Cards filter by keyboard.
      await adminNav(page, "Cards")
      const filter = page.getByRole("combobox", { name: "Filter by group" })
      await filter.focus()
      await page.keyboard.press("Enter")
      await expect(page.getByRole("option", { name: "All groups" })).toBeFocused()
      for (const next of ["First Years", "Adepts", "Masters"]) {
        await page.keyboard.press("ArrowDown")
        await expect(page.getByRole("option", { name: next })).toBeFocused()
      }
      await page.keyboard.press("Enter")
      await expect(filter).toHaveText("Masters")
      await expect(filter).toBeFocused()
      await expect(page.getByRole("button", { name: /Galen Coldspire/ })).toBeVisible()
      await expect(page.getByRole("button", { name: /Aria Ashgrove/ })).toHaveCount(0)

      // Pack: archetype tones show a swatch.
      await adminNav(page, "Cards")
      await expect(page.getByRole("textbox", { name: "Label (tiered)" })).toHaveCount(3)
      await expect(page.getByRole("textbox", { name: "Label (unique)" })).toHaveCount(0)
      await adminNav(page, "Resources")
      const tone = page.getByRole("combobox", { name: "Tone" }).first()
      await tone.click()
      await expect(page.getByRole("option", { name: "violet" })).toBeVisible()
      await page.getByRole("option", { name: "violet" }).click()
      await expect(tone).toHaveText("violet")
      await noOverflow(page)
    })
  }

  test("card editor selects keep editing behaviour", async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: DESKTOP })).newPage()
    await page.goto(ADMIN)
    await adminNav(page, "Cards")
    await page.getByRole("button", { name: /Aria Ashgrove/ }).click()
    const permanent = page.getByRole("combobox", { name: "Permanent resource" })
    await expect(permanent).toHaveText("Ember")
    await permanent.click()
    await page.getByRole("option", { name: "Stone" }).click()
    await expect(permanent).toHaveText("Stone")
    await page.keyboard.press("Escape")
    await adminNav(page, "Versions")
    await expect(page.getByText(/permanentResource: "ember" → "stone"/)).toBeVisible()
  })
})

test("game menu theme switch is a toggle group", async ({ browser }) => {
  const { seats } = await openRoomUi(browser, ["Ana", "Ben"])
  const page = seats[0].page
  await page.getByRole("button", { name: "Start game" }).click()
  await page.getByRole("button", { name: "Game menu" }).click()
  const group = page.getByRole("radiogroup", { name: "Theme" })
  await group.getByRole("radio", { name: "dark" }).click()
  await expect(page.locator("html")).toHaveClass(/dark/)
  await expect(group.getByRole("radio", { name: "dark" })).toHaveAttribute("aria-checked", "true")
  // Arrow keys move between options; Space selects.
  await page.keyboard.press("ArrowRight")
  await expect(group.getByRole("radio", { name: "system" })).toBeFocused()
  await page.keyboard.press("ArrowLeft")
  await expect(group.getByRole("radio", { name: "dark" })).toBeFocused()
  await page.keyboard.press("ArrowLeft")
  await expect(group.getByRole("radio", { name: "light" })).toBeFocused()
  await page.keyboard.press("Space")
  await expect(page.locator("html")).not.toHaveClass(/dark/)
  // Clicking the active option keeps a theme selected.
  await group.getByRole("radio", { name: "light" }).click()
  await expect(group.getByRole("radio", { name: "light" })).toHaveAttribute("aria-checked", "true")
  await axe(page, "game-menu")
})
