import { expect, test } from "./browser-fixtures"
import { activeSeat, DESKTOP, finishWithBots, openRoomUi, PHONE, startGame, uiTurn } from "./helpers"

test("two players play a complete game in the browser, start to winner", async ({ browser, request }) => {
  test.setTimeout(600_000)
  const { seats, code } = await openRoomUi(browser, ["Ana", "Ben"], [PHONE, DESKTOP])
  await startGame(seats)
  const counts = { acquire: 0, collect: 0, reserve: 0, pass: 0 }
  for (let turn = 0; turn < 140; turn++) {
    const seat = await activeSeat(request, code, seats)
    if (!seat) break
    counts[await uiTurn(seat.page)]++
    // The other device sees the same revision.
    const other = seats.find((s) => s !== seat)!
    await expect(other.page.getByRole("button", { name: "Game menu" }).or(other.page.getByRole("heading", { name: /win|Shared victory/ }))).toBeVisible()
  }
  expect(counts.acquire).toBeGreaterThan(3)
  for (const s of seats) await expect(s.page.getByRole("heading", { name: /You win|wins|Shared victory/ })).toBeVisible()
  await expect(seats[0].page.getByRole("list", { name: "Final standings" }).getByRole("listitem")).toHaveCount(2)
  await seats[0].page.screenshot({ path: "test-results/evidence/390-results.png", fullPage: true })
  await seats[1].page.screenshot({ path: "test-results/evidence/1280-results.png", fullPage: true })
  console.log(`UI game finished: ${JSON.stringify(counts)}`)
})

for (const n of [3, 4]) {
  test(`${n} players: lobby, a UI round, then to a winner on real server state`, async ({ browser, request }) => {
    const names = ["Ana", "Ben", "Cy", "Dee"].slice(0, n)
    const { seats, code } = await openRoomUi(browser, names, [PHONE, DESKTOP, { width: 360, height: 780 }])
    await startGame(seats)
    for (let i = 0; i < n; i++) {
      const seat = (await activeSeat(request, code, seats))!
      await uiTurn(seat.page)
    }
    // Every device shows every player's first turn in its standings.
    for (const s of seats) await expect(s.page.getByRole("list", { name: "Standings" }).getByRole("listitem")).toHaveCount(n)
    const end = await finishWithBots(request, code, seats)
    expect(end.status).toBe("finished")
    for (const s of seats) await expect(s.page.getByRole("heading", { name: /You win|wins|Shared victory/ })).toBeVisible({ timeout: 15_000 })
  })
}

test("the host can end a game for everyone", async ({ browser }) => {
  const { seats } = await openRoomUi(browser, ["Ana", "Ben"])
  await startGame(seats)
  await seats[0].page.getByRole("button", { name: "Game menu" }).click()
  await seats[0].page.getByRole("button", { name: "End game for everyone" }).click()
  await seats[0].page.getByRole("button", { name: "End game", exact: true }).click()
  for (const s of seats) await expect(s.page.getByRole("heading", { name: "Game ended" })).toBeVisible()
  await expect(seats[1].page.getByText("No winner is declared")).toBeVisible()
})

test("lobby rejects a fifth player and late joiners", async ({ browser }) => {
  const { seats } = await openRoomUi(browser, ["Ana", "Ben", "Cy", "Dee"])
  const extra = await (await browser.newContext({ viewport: PHONE })).newPage()
  await extra.goto(seats[0].page.url())
  await expect(extra.getByText("This room is full")).toBeVisible()
  await startGame(seats)
  await extra.reload()
  await expect(extra.getByRole("heading", { name: "This game has started" })).toBeVisible()
  await extra.goto("/r/ZZZZZZ")
  await expect(extra.getByRole("heading", { name: "Room not found" })).toBeVisible()
})
