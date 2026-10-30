import { expect, test, type Page } from "./browser-fixtures"
import { activeSeat, axe, axeToasts, noOverflow, openRoomUi, startGame, uiTurn, FIXTURE } from "./helpers"

const WIDTHS = [320, 360, 390, 768, 1280]

for (const width of WIDTHS) {
  test(`layout and accessibility at ${width}px`, async ({ browser, request }) => {
    const viewport = { width, height: width < 768 ? 800 : 900 }
    const { seats, code } = await openRoomUi(browser, ["Ana", "Ben"], [viewport])
    const shot = (p: Page, name: string) => p.screenshot({ path: `test-results/evidence/${width}-${name}.png`, fullPage: true })

    const home = await seats[0].context.newPage()
    await home.goto("/")
    await noOverflow(home)
    await axe(home, "home")
    await shot(home, "home")

    await noOverflow(seats[0].page)
    await axe(seats[0].page, "lobby")
    await shot(seats[0].page, "lobby")

    await startGame(seats)
    const seat = (await activeSeat(request, code, seats))!
    await uiTurn(seat.page)
    const now = (await activeSeat(request, code, seats))!
    const page = now.page
    await expect(page.getByText("Your turn").first()).toBeVisible()
    await noOverflow(page)
    await axe(page, "board")
    await shot(page, "board")

    const callout = page.getByRole("region", { name: FIXTURE.collect, exact: true })
    const action = page.getByRole("button", { name: FIXTURE.collect, exact: true })
    await expect(action).toHaveCount(1)
    await expect(callout.getByRole("button", { name: "Key", exact: true })).toBeVisible()
    await expect(page.locator("main").getByText("First to 15", { exact: true })).toHaveCount(0)
    const content = await callout.getByLabel("Supply", { exact: true }).boundingBox()
    const button = (await action.boundingBox())!
    if (width < 640) {
      expect(button.y).toBeGreaterThan(content!.y)
      expect(button.width).toBeCloseTo(content!.width, 0)
    } else expect(button.x).toBeGreaterThan(content!.x + content!.width)
    await callout.screenshot({ path: `test-results/ui-review/proj7-callout-${width}.png` })

    await page.getByRole("button", { name: FIXTURE.collect, exact: true }).locator("visible=true").click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await noOverflow(page)
    await axe(page, "collect")
    await page.screenshot({ path: `test-results/evidence/${width}-collect.png` })
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toBeHidden()

    await page.locator("main section button[aria-label*='Cost']:visible").first().click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await noOverflow(page)
    await axe(page, "card")
    await page.screenshot({ path: `test-results/evidence/${width}-card.png` })
  })
}

test("dark theme has no serious contrast issues", async ({ browser, request }) => {
  const { seats, code } = await openRoomUi(browser, ["Ana", "Ben"], [{ width: 390, height: 800 }])
  for (const s of seats) await s.page.emulateMedia({ colorScheme: "dark" })
  await startGame(seats)
  const first = (await activeSeat(request, code, seats))!
  await uiTurn(first.page)
  // The other player now sees turn toasts.
  const page = seats.find((s) => s !== first)!.page
  // Hover pauses toast expiry; inspect it before the slower full-board scan.
  await axeToasts(page, "toasts-dark")
  await axe(page, "board-dark")
  await page.getByRole("region", { name: FIXTURE.collect, exact: true }).screenshot({ path: "test-results/ui-review/proj7-callout-dark.png" })
  await page.screenshot({ path: "test-results/evidence/390-board-dark.png", fullPage: true })
})
