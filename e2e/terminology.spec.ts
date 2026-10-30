import { expect, test } from "./browser-fixtures"
import { starfallContent } from "../tests/fixtures/starfall"
import { activeSeat, myTurn, noOverflow, openRoomUi, session, startGame, uiTurn } from "./helpers"
import { ISOLATED_PAIRS } from "./ports"

test("Reserve holds the selected card and records a reserve action", async ({ browser, request }) => {
  const { seats, code } = await openRoomUi(browser, ["Reserve host", "Reserve guest"])
  try {
    await startGame(seats)
    const seat = (await activeSeat(request, code, seats))!
    const auth = await session(seat.page, code)
    const headers = { authorization: `Bearer ${auth.token}` }
    const before = await (await request.get(`/api/rooms/${code}`, { headers })).json()
    const cardId = before.game.market["first-years"][0]
    const beforePlayer = before.game.players.find((p: { id: string }) => p.id === auth.playerId)
    await seat.page.locator("main section button[aria-label*='Cost']:visible").first().click()
    const reserve = seat.page.getByRole("dialog").getByRole("button", { name: /^Reserve\b/ })
    await expect(reserve).toBeEnabled()
    await reserve.click()
    await expect(seat.page.getByRole("dialog")).toBeHidden()
    const after = await (await request.get(`/api/rooms/${code}`, { headers })).json()
    const player = after.game.players.find((p: { id: string }) => p.id === auth.playerId)
    expect(player.reserved).toContain(cardId)
    expect(player.acquired).toEqual(beforePlayer.acquired)
    expect(player.resources).toEqual(beforePlayer.resources)
    expect(player.wildcards).toBe(beforePlayer.wildcards + Math.min(1, before.game.supply.wildcards))
    expect(after.game.log).toContainEqual(expect.objectContaining({ type: "reserve", card: cardId, player: auth.playerId }))
    await expect(seat.page.locator("main").getByText("Reserved", { exact: true }).locator("visible=true")).toBeVisible()
  } finally {
    for (const seat of seats) await seat.context.close()
  }
})

test("the existing resource label controls the callout, action sheet and activity log", async ({ page }) => {
  const { pack, rules } = starfallContent()
  pack.id = "future-stars"
  pack.name = "Future stars test"
  pack.labels.collect = "Draft {label:resources}"
  pack.labels.collected = "Drafted {label:resources}"
  pack.labels.resources = "Future stars"
  // Makes its pack the default, so it runs on its own server pair.
  const game = `http://localhost:${ISOLATED_PAIRS.labels}`
  await page.goto(`http://127.0.0.1:${ISOLATED_PAIRS.labels + 1}`)
  await page.getByLabel("Import JSON file").setInputFiles({ name: "future.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ pack, rules })) })
  await page.getByRole("button", { name: "Import", exact: true }).click()
  await page.getByRole("button", { name: "Publish version" }).click()
  await page.getByRole("button", { name: "Publish", exact: true }).click()
  await page.getByRole("button", { name: "Make default" }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await page.goto(game)
  await page.getByLabel("Your name").fill("Labels")
  await page.getByRole("button", { name: "Create room" }).click()
  await page.getByRole("button", { name: "Add bot" }).click()
  await page.getByRole("button", { name: "Start game" }).click()
  await expect(myTurn(page)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole("region", { name: "Draft Future stars", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Draft Future stars", exact: true })).toHaveCount(1)
  await noOverflow(page)
  expect(await uiTurn(page, { collect: "Draft Future stars", acquire: "Bond", reserve: "Reserve" })).toBe("collect")
  await expect(page.locator("aside").getByText("Drafted Future stars", { exact: true }).first()).toBeVisible()
  await page.getByRole("button", { name: "Game menu" }).click()
  await expect(page.getByRole("dialog").getByText(/On your turn, Draft Future stars, Reserve or Bond/)).toBeVisible()
})
