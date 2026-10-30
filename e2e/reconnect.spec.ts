import { expect, test } from "./browser-fixtures"
import { activeSeat, FIXTURE, openRoomUi, PHONE, session, startGame, uiTurn } from "./helpers"

test("reload and a second device restore the same guest and sync live", async ({ browser, request }) => {
  const { seats, code } = await openRoomUi(browser, ["Ana", "Ben"])
  await startGame(seats)
  const first = (await activeSeat(request, code, seats))!
  await uiTurn(first.page)

  // Reload: same identity, same game.
  const idle = seats.find((s) => s !== first)!
  const before = await session(idle.page, code)
  await idle.page.reload()
  await expect(idle.page.getByText("Your turn").first()).toBeVisible()
  expect(await session(idle.page, code)).toEqual(before)

  // A second device holding the same saved session resumes the same guest.
  const other = await browser.newContext({ viewport: PHONE })
  await other.addInitScript(([c, s]) => localStorage.setItem(`trovekit:session:${c}`, s), [code, JSON.stringify(before)] as const)
  const twin = await other.newPage()
  await twin.goto(`/r/${code}`)
  await expect(twin.getByText("Your turn").first()).toBeVisible()
  // The header names the room's own game.
  await expect(twin.getByRole("link", { name: `${FIXTURE.name} home` })).toBeVisible()
  expect(await session(twin, code)).toEqual(before)

  // An action on one device shows up on the other and on the opponent.
  await uiTurn(idle.page)
  await expect(twin.getByText(/'s turn/).first()).toBeVisible()
  await expect(first.page.getByText("Your turn").first()).toBeVisible()
})

test("a stale tab cannot act on an old revision", async ({ browser, request }) => {
  const { seats, code } = await openRoomUi(browser, ["Ana", "Ben"])
  await startGame(seats)
  const seat = (await activeSeat(request, code, seats))!
  const s = await session(seat.page, code)
  const res = await request.post(`/api/rooms/${code}/actions`, {
    headers: { authorization: `Bearer ${s.token}` },
    data: { actionId: crypto.randomUUID(), expectedRevision: 7, action: { type: "pass" } },
  })
  expect(res.status()).toBe(409)
  expect((await res.json()).code).toBe("STALE_REVISION")
})

test("a forged session is refused and the player is asked to join", async ({ browser }) => {
  const { seats, code } = await openRoomUi(browser, ["Ana", "Ben"])
  const ctx = await browser.newContext({ viewport: PHONE })
  await ctx.addInitScript((c) => localStorage.setItem(`trovekit:session:${c}`, JSON.stringify({ playerId: "x", token: "forged-token-forged-token-forged" })), code)
  const p = await ctx.newPage()
  await p.goto(`/r/${code}`)
  await expect(p.getByRole("heading", { name: `Join Room ${code.split("").join(" ")}` })).toBeVisible()
  void seats
})
