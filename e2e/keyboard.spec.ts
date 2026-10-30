import { expect, test } from "./browser-fixtures"
import { activeSeat, DESKTOP, openRoomUi, startGame, FIXTURE } from "./helpers"

test("a turn can be played with the keyboard alone", async ({ browser, request }) => {
  const { seats, code } = await openRoomUi(browser, ["Ana", "Ben"], [DESKTOP])
  await startGame(seats)
  const page = (await activeSeat(request, code, seats))!.page
  const collect = page.getByRole("button", { name: FIXTURE.collect, exact: true }).locator("visible=true")
  await collect.focus()
  await page.keyboard.press("Enter")
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  // Focus moves into the dialog; tab to three supply kinds and toggle them with Space.
  const kinds = dialog.locator('button[aria-label*="in supply"]')
  for (let i = 0; i < 3; i++) {
    await kinds.nth(i).focus()
    await page.keyboard.press("Space")
    await expect(kinds.nth(i)).toHaveAttribute("aria-pressed", "true")
  }
  await dialog.getByRole("button", { name: new RegExp(`^${FIXTURE.collect} .+`) }).focus()
  await page.keyboard.press("Enter")
  await expect(dialog).toBeHidden()
  await expect(page.getByText(/'s turn/).first()).toBeVisible()

  // Cards open with Enter and close with Escape.
  const card = page.locator("main section button[aria-label*='Cost']").first()
  await card.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toBeHidden()
})
