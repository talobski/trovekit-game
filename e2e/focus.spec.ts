import { expect, test, type Locator, type Page } from "./browser-fixtures"
import { adminNav, activeSeat, DESKTOP, openRoomUi, PHONE, startGame, FIXTURE } from "./helpers"

const ADMIN = "http://127.0.0.1:5281"

/** Where focus is, relative to the open sheet. */
const focusInfo = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    const dialog = el?.closest("[role=dialog]")
    const r = el?.getBoundingClientRect()
    return {
      inDialog: !!dialog,
      isBody: el?.getAttribute("tabindex") === "0" && el?.dataset.slot === "scroll-area-viewport",
      inView: !!r && r.bottom > 0 && r.top < innerHeight,
      connected: !!el && document.contains(el),
      tag: el?.tagName ?? "",
    }
  })

/** Open a sheet from its trigger with the keyboard, check focus moved inside, close with Escape, check focus came back. */
async function roundTrip(page: Page, opener: Locator, expectFocus: (page: Page) => Promise<void>) {
  await opener.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog")).toBeVisible()
  await expectFocus(page)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toBeHidden()
  await expect(opener).toBeFocused()
}

const bodyFocused = async (page: Page) => {
  await expect.poll(() => focusInfo(page)).toMatchObject({ inDialog: true, isBody: true, inView: true })
}

for (const viewport of [PHONE, DESKTOP]) {
  const label = viewport === PHONE ? "phone drawer" : "desktop dialog"

  test(`game sheets move focus in and restore it (${label})`, async ({ browser, request }) => {
    const { seats, code } = await openRoomUi(browser, ["Ana", "Ben"], [viewport])
    await startGame(seats)
    const page = (await activeSeat(request, code, seats))!.page

    // Card details: content-first, so the readable body takes focus.
    const card = page.locator("main section button[aria-label*='Cost']").first()
    await roundTrip(page, card, bodyFocused)

    // Recruit: a task, so the first supply kind takes focus.
    const collect = page.getByRole("button", { name: FIXTURE.collect, exact: true }).locator("visible=true")
    await roundTrip(page, collect, async (p) => {
      await expect(p.getByRole("dialog").locator('button[aria-label*="in supply"]').first()).toBeFocused()
    })

    // Game menu: rules and the log come first; the body takes focus and is on screen.
    await roundTrip(page, page.getByRole("button", { name: "Game menu" }), bodyFocused)

    // A player's collection.
    const tile = page.getByRole("list", { name: "Standings" }).getByRole("button").first()
    await roundTrip(page, tile, bodyFocused)
  })

  test(`admin editors open on their first field and restore focus (${label})`, async ({ browser }) => {
    const page = await (await browser.newContext({ viewport })).newPage()
    await page.goto(ADMIN)

    await adminNav(page, "Cards")
    await roundTrip(page, page.getByRole("button", { name: /Aria Ashgrove/ }), async (p) => {
      await expect(p.getByRole("dialog").getByLabel("Name", { exact: true })).toBeFocused()
    })

    await adminNav(page, "Achievements")
    await roundTrip(page, page.getByRole("button", { name: /Tidecallers/ }), async (p) => {
      await expect(p.getByRole("dialog").getByLabel("Name", { exact: true })).toBeFocused()
    })

    await adminNav(page, "Relationships")
    await roundTrip(page, page.getByRole("button", { name: /Aria Ashgrove and Bram Ashgrove/ }), async (p) => {
      await expect(p.getByRole("dialog").getByLabel("Label", { exact: true })).toBeFocused()
    })
  })

  test(`focus falls back safely when the opener is gone (${label})`, async ({ browser }) => {
    const page = await (await browser.newContext({ viewport })).newPage()
    await page.goto(ADMIN)
    await adminNav(page, "Cards")
    const row = page.getByRole("button", { name: /Juno Coldspire/ })
    await row.focus()
    await page.keyboard.press("Enter")
    await page.getByRole("dialog").getByRole("button", { name: "Delete card" }).click()
    await expect(page.getByRole("dialog")).toBeHidden()
    await expect(row).toHaveCount(0)
    // Never left on a removed element; the next Tab lands on something on the page.
    expect(await focusInfo(page)).toMatchObject({ connected: true, inDialog: false })
    await page.keyboard.press("Tab")
    expect(await focusInfo(page)).toMatchObject({ connected: true })
    expect((await focusInfo(page)).tag).not.toBe("BODY")
  })
}
