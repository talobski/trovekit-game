import { expect, test, type Page } from "./browser-fixtures"
import { axe, axeToasts, DESKTOP, myTurn, noOverflow, PHONE, resultHeading, uiTurn } from "./helpers"

async function soloRoom(page: Page, bots: number) {
  await page.goto("/")
  await page.getByLabel("Your name").fill("Ana")
  await page.getByRole("button", { name: "Create room" }).click()
  await page.waitForURL(/\/r\/[A-Z0-9]{6}$/)
  await expect(page.getByRole("button", { name: "Leave room" })).toBeVisible()
  for (let i = 1; i <= bots; i++) {
    await page.getByRole("button", { name: "Add bot" }).click()
    await expect(page.getByText(`Bot ${i}`, { exact: true })).toBeVisible()
  }
}

test("the host adds and removes bots, up to four players", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: PHONE })).newPage()
  await soloRoom(page, 0)
  await expect(page.getByRole("button", { name: "Start game" })).toBeDisabled()
  await expect(page.getByText("Invite someone or add a bot.")).toBeVisible()
  for (let i = 1; i <= 3; i++) await page.getByRole("button", { name: "Add bot" }).click()
  await expect(page.getByText("4 of 4")).toBeVisible()
  await expect(page.getByRole("button", { name: "Add bot" })).toBeHidden()
  await page.getByRole("button", { name: "Remove Bot 2" }).click()
  await expect(page.getByText("3 of 4")).toBeVisible()
  await expect(page.getByText("Bot 2", { exact: true })).toBeHidden()
  await expect(page.getByRole("button", { name: "Add bot" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Start game" })).toBeEnabled()
  await noOverflow(page)
  await axe(page, "lobby-with-bots")

  // A friend joining sees the bots but cannot change them.
  const friend = await (await browser.newContext({ viewport: PHONE })).newPage()
  await friend.goto(page.url())
  await friend.getByLabel("Your name").fill("Ben")
  await friend.getByRole("button", { name: "Join", exact: true }).click()
  await expect(friend.getByText("Bot 1", { exact: true })).toBeVisible()
  await expect(friend.getByRole("button", { name: /Remove Bot/ })).toHaveCount(0)
  await expect(friend.getByRole("button", { name: "Add bot" })).toHaveCount(0)
  await expect(page.getByText("4 of 4")).toBeVisible()
})

for (const [bots, viewport, label] of [
  [1, PHONE, "phone"],
  [2, DESKTOP, "desktop"],
  [3, PHONE, "phone"],
] as const) {
  test(`1 human against ${bots} ${bots === 1 ? "bot" : "bots"} plays a full game in the browser (${label})`, async ({ browser }) => {
    test.setTimeout(400_000)
    const page = await (await browser.newContext({ viewport })).newPage()
    await soloRoom(page, bots)
    await page.getByRole("button", { name: "Start game" }).click()
    await expect(page.getByRole("button", { name: "Game menu" })).toBeVisible()

    const moves = { acquire: 0, collect: 0, reserve: 0, pass: 0 }
    let shot = false
    for (let turn = 0; turn < 300; turn++) {
      // Bots move on their own; wait for our turn or the end.
      await expect(myTurn(page).or(resultHeading(page))).toBeVisible({ timeout: 30_000 })
      if (await resultHeading(page).isVisible()) break
      moves[await uiTurn(page)]++
      if (!shot && turn === 6) {
        // This turn's toasts close after 3.5s, which the board checks below can outlast
        // on a slow machine. Pointing at the stack expands it, and sonner pauses it until
        // the pointer leaves, so axeToasts scans the same toasts. New toasts keep sliding
        // in, so point without waiting for one to stand still, and check the stack expanded.
        await expect(page.locator("[data-sonner-toast]").first()).toBeVisible()
        await expect(async () => {
          await page.locator("[data-sonner-toast]").first().hover({ force: true, timeout: 1000 })
          await expect(page.locator('[data-sonner-toast][data-expanded="true"]').first()).toBeVisible({ timeout: 500 })
        }).toPass({ timeout: 5000 })
        await noOverflow(page)
        await axe(page, `board-${bots}-bots`)
        await axeToasts(page, `toasts-${bots}-bots`)
        await page.mouse.move(0, viewport.height - 1)
        await page.screenshot({ path: `test-results/evidence/bots-${bots}-${label}-board.png`, fullPage: true })
        shot = true
      }
    }
    await expect(resultHeading(page)).toBeVisible()
    const standings = page.getByRole("list", { name: "Final standings" }).getByRole("listitem")
    await expect(standings).toHaveCount(1 + bots)
    for (let i = 1; i <= bots; i++) await expect(standings.filter({ hasText: `Bot ${i}` })).toHaveCount(1)
    await page.screenshot({ path: `test-results/evidence/bots-${bots}-${label}-results.png`, fullPage: true })
    expect(moves.acquire + moves.collect).toBeGreaterThan(5)
    console.log(`1 human + ${bots} bots: human moves ${JSON.stringify(moves)}; ${await page.getByRole("heading", { level: 1 }).textContent()}`)
  })
}
