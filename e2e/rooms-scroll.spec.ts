import { expect, test, type Page } from "./browser-fixtures"
import { adminNav, axe, DESKTOP, noOverflow, PHONE } from "./helpers"

const ADMIN = "http://127.0.0.1:5281"

async function create(page: Page, name = "Ana") {
  await page.goto("/")
  await page.getByLabel("Your name").fill(name)
  await page.getByRole("button", { name: "Create room" }).click()
  await page.waitForURL(/\/r\/[A-Z0-9]{6}$/)
  await expect(page.getByRole("button", { name: "Leave room" })).toBeVisible()
}

/** The room heading's accessible name: screen readers hear the code letter by letter. */
const spelled = (code: string) => code.split("").join(" ")

test.describe("room codes", () => {
  test("the code names the room in the lobby, the invite, after reconnecting and in the game", async ({ browser }) => {
    const host = await (await browser.newContext({ viewport: PHONE })).newPage()
    await host.goto("/")
    await expect(host.getByLabel("Room name")).toHaveCount(0)
    await create(host)
    const code = new URL(host.url()).pathname.split("/").pop()!
    await expect(host.getByRole("heading", { level: 1, name: `Room ${spelled(code)}` , exact: true })).toBeVisible()
    await expect(host.getByText("Trovekit Game Room")).toHaveCount(0)
    await expect(host.getByText("Ana (you)")).toBeVisible()
    await axe(host, "room-code-lobby")
    await noOverflow(host)

    const friend = await (await browser.newContext({ viewport: PHONE })).newPage()
    await friend.goto(host.url())
    await expect(friend.getByRole("heading", { level: 1, name: `Join Room ${spelled(code)}` , exact: true })).toBeVisible()
    await friend.getByLabel("Your name").fill("Ben")
    await friend.getByRole("button", { name: "Join", exact: true }).click()
    await expect(friend.getByRole("heading", { level: 1, name: `Room ${spelled(code)}` , exact: true })).toBeVisible()

    await friend.reload()
    await expect(friend.getByRole("heading", { level: 1, name: `Room ${spelled(code)}` , exact: true })).toBeVisible()
    await expect(friend.getByText("Ben (you)")).toBeVisible()

    await host.getByRole("button", { name: "Start game" }).click()
    await host.getByRole("button", { name: "Game menu" }).click()
    await expect(host.getByRole("dialog", { name: `Room ${code}` })).toBeVisible()
  })

  test("rooms saved with a custom or default name load and show only their code", async ({ browser, request }) => {
    // The API still accepts and stores a room name (older clients, saved rooms); the UI never shows it.
    for (const roomName of ["Friday Game Night", ""]) {
      const res = await request.post("/api/rooms", { data: { name: "Ana", roomName } })
      expect(res.status()).toBe(201)
      const { code, token, playerId } = await res.json()
      const context = await browser.newContext({ viewport: DESKTOP })
      await context.addInitScript(([c, s]) => localStorage.setItem(`trovekit:session:${c}`, s), [code, JSON.stringify({ playerId, token })])
      const page = await context.newPage()
      await page.goto(`/r/${code}`)
      await expect(page.getByRole("heading", { level: 1, name: `Room ${spelled(code)}` , exact: true })).toBeVisible()
      await expect(page.getByText(/Friday Game Night|Trovekit Game Room/)).toHaveCount(0)
      const guest = await (await browser.newContext({ viewport: PHONE })).newPage()
      await guest.goto(`/r/${code}`)
      await expect(guest.getByRole("heading", { level: 1, name: `Join Room ${spelled(code)}` , exact: true })).toBeVisible()
      await expect(guest.getByText(/Friday Game Night|Trovekit Game Room/)).toHaveCount(0)
      await context.close()
      await guest.context().close()
    }
  })
})

test.describe("scroll areas", () => {
  for (const viewport of [{ width: 390, height: 600 }, { width: 1280, height: 560 }]) {
    test(`sheets and lists scroll inside themed scroll areas (${viewport.width}px)`, async ({ browser }) => {
      const page = await (await browser.newContext({ viewport })).newPage()
      await create(page)
      await page.getByRole("button", { name: "Add bot" }).click()
      await page.getByRole("button", { name: "Start game" }).click()

      // Game menu: the body is the scrolling viewport; the page itself does not scroll.
      await page.getByRole("button", { name: "Game menu" }).click()
      const viewportEl = page.getByRole("dialog").locator("[data-slot=scroll-area-viewport]")
      await expect(viewportEl).toBeFocused()
      const size = await viewportEl.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }))
      expect(size.scroll).toBeGreaterThan(size.client)
      // Keyboard scrolling works on the focused body.
      await page.keyboard.press("End")
      await expect.poll(() => viewportEl.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
      // A themed scrollbar is shown (not hidden) while there is more to see.
      await expect(page.getByRole("dialog").locator("[data-slot=scroll-area-thumb]")).toBeVisible()
      await noOverflow(page)
      await axe(page, "menu-scroll")
      await page.keyboard.press("Escape")

      // The page keeps native scrolling, with the platform's own scrollbar.
      expect(await page.evaluate(() => [document.scrollingElement === document.documentElement, getComputedStyle(document.documentElement).scrollbarColor])).toEqual([true, "auto"])
    })

    test(`combobox results scroll and keep the highlighted player in view (${viewport.width}px)`, async ({ browser }) => {
      const page = await (await browser.newContext({ viewport })).newPage()
      await page.goto(ADMIN)
      // By keyboard through the sidebar (a sheet on phones); focus lands on the new page's heading.
      await expect(page.locator("#page-title")).toBeVisible()
      const nav = page.getByRole("navigation", { name: "Admin" })
      if (!(await nav.isVisible())) {
        await page.getByRole("button", { name: "Toggle sidebar" }).focus()
        await page.keyboard.press("Enter")
      }
      await nav.getByRole("link", { name: "Relationships", exact: true }).focus()
      await page.keyboard.press("Enter")
      await expect(page.getByRole("heading", { name: "Relationships", level: 1 })).toBeFocused()
      await page.getByRole("button", { name: /Aria Ashgrove and Bram Ashgrove/ }).click()
      await page.locator("#rel-card-0").click()
      const list = page.locator("[cmdk-list] [data-slot=scroll-area-viewport]")
      await expect(list).toBeVisible()
      for (let i = 0; i < 25; i++) await page.keyboard.press("ArrowDown")
      const highlighted = page.locator("[cmdk-item][aria-selected=true]")
      // Measure in one browser frame and wait for cmdk scrolling / the phone
      // drawer animation. Separate async rectangles can come from different frames.
      await expect.poll(() => highlighted.evaluate(el => {
        const box = el.getBoundingClientRect()
        const area = el.closest('[data-slot="scroll-area-viewport"]')!.getBoundingClientRect()
        return box.y >= area.y - 1 && box.bottom <= area.bottom + 1
      })).toBe(true)
      expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
      await noOverflow(page)
    })
  }

  test("admin change list scrolls inside its own area and is keyboard reachable", async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await page.goto(ADMIN)
    await adminNav(page, "Rules")
    for (const label of ["Target points", "Holding cap", "Reserve cap", "Wildcards", "Min players", "Max players"]) await page.getByLabel(label, { exact: true }).fill("3")
    await adminNav(page, "Cards")
    for (const name of [/Galen Coldspire/, /Hollis Coldspire/, /Ilya Coldspire/]) {
      await page.getByRole("button", { name }).click()
      await page.getByLabel("Points", { exact: true }).fill("5")
      await page.keyboard.press("Escape")
      await expect(page.getByRole("dialog")).toBeHidden()
    }
    await adminNav(page, "Versions")
    const region = page.getByRole("region", { name: "Changes" })
    await expect(region).toBeVisible()
    await axe(page, "change-list")
  })
})
