import type { Page } from "@playwright/test"
import { expect, test } from "./browser-fixtures"
import { starfallContent } from "../tests/fixtures/starfall"
import { adminNav, axe, DESKTOP, noOverflow, syntheticTouchScrolls } from "./helpers"
import { ISOLATED_PAIRS } from "./ports"

/*
 * Public game UI: milestone cards and the phone's Resource strength
 * footer that opens your collection, native page scrolling with
 * full-width dividers, and the game's own title and icon.
 * Runs on its own seeded pair; the title and icon tests come last, since they change
 * the default.
 */

test.describe.configure({ mode: "serial" })

const GAME = `http://localhost:${ISOLATED_PAIRS.gameUi}`
const ADMIN = `http://127.0.0.1:${ISOLATED_PAIRS.gameUi + 1}`
const SCHEMES = ["light", "dark"] as const
const CATEGORIES = starfallContent().pack.achievementCategories.map((c) => c.label)

async function startRoom(page: Page) {
  await page.goto(GAME)
  await page.getByLabel("Your name").fill("Ana")
  await page.getByRole("button", { name: "Create room" }).click()
  await page.getByRole("button", { name: "Add bot" }).click()
  await page.getByRole("button", { name: "Start game" }).click()
  await expect(page.getByRole("button", { name: "Game menu" })).toBeVisible()
}

/** Shows the first drawn milestone as claimed by the first player, to the page only: the server's game is untouched. */
async function showFirstClaimed(page: Page) {
  const claim = (room: { game?: { achievements: string[]; claimed: Record<string, string>; players: { id: string }[] } }) => {
    if (room.game) room.game.claimed = { [room.game.achievements[0]]: room.game.players[0].id }
    return room
  }
  await page.routeWebSocket(/\/ws$/, (ws) => {
    const server = ws.connectToServer()
    server.onMessage((message) => {
      const msg = JSON.parse(String(message))
      ws.send(JSON.stringify(msg.type === "room" ? { ...msg, room: claim(msg.room) } : msg))
    })
  })
  await page.route(/\/api\/rooms\/[A-Z0-9]{6}$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    const response = await route.fetch()
    await route.fulfill({ response, json: claim(await response.json()) })
  })
}

for (const [viewport, label] of [[{ width: 390, height: 844 }, "phone"], [DESKTOP, "desktop"]] as const)
  for (const scheme of SCHEMES)
    test(`milestones show name, points and requirement, without their category (${label}, ${scheme})`, async ({ browser }) => {
      const page = await (await browser.newContext({ viewport, colorScheme: scheme })).newPage()
      await showFirstClaimed(page)
      await startRoom(page)
      const section = page.locator("section", { has: page.locator("#achievements") })
      const items = section.getByRole("listitem")
      await expect(items.first()).toBeVisible()
      const cards = await items.evaluateAll((lis) =>
        lis.map((li) => {
          const text = li.querySelector(":scope > span:last-child")!
          return { lines: [...text.children].map((c) => c.textContent ?? ""), points: li.firstElementChild!.textContent }
        }),
      )
      expect(cards.length).toBeGreaterThan(0)
      for (const [i, card] of cards.entries()) {
        expect(card.points).toMatch(/^\+\d+$/)
        // Name and requirement, and for the claimed one who claimed it: no category,
        // and no empty line left where it was.
        expect(card.lines.length, `milestone ${i}`).toBe(i === 0 ? 3 : 2)
        for (const line of card.lines) expect(line.trim(), `milestone ${i}`).not.toBe("")
        // (Whole lines: a milestone's own name may share a word with a category.)
        for (const line of card.lines) expect(CATEGORIES, `milestone ${i}`).not.toContain(line.trim())
      }
      expect(cards[0].lines[2].trim()).toBe("Claimed by Ana")
      await section.scrollIntoViewIfNeeded()
      await noOverflow(page)
      await axe(page, `milestones ${label} ${scheme}`)
      await section.screenshot({ path: `test-results/evidence/game-ui-milestones-${label}-${scheme}.png` })
      await page.context().close()
    })

const footer = (page: Page) => page.locator("[data-strength-footer]")
const OPEN = "Open your circle"

for (const width of [320, 375, 390])
  for (const scheme of SCHEMES)
    test(`at ${width}px the strength footer is a compact sheet handle that opens your collection (${scheme})`, async ({ browser }) => {
      const page = await (await browser.newContext({ viewport: { width, height: 760 }, colorScheme: scheme, hasTouch: true })).newPage()
      await startRoom(page)
      const bar = footer(page)
      const button = page.getByRole("button", { name: OPEN })
      await expect(button).toBeVisible()
      const layout = await bar.evaluate((el) => {
        const box = (e: Element) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom } }
        const handle = el.querySelector("[aria-hidden].rounded-full")!
        const items = [...el.querySelectorAll("li")]
        const style = getComputedStyle(el)
        return {
          bar: box(el),
          handle: box(handle),
          items: items.map((li) => ({ li: box(li), clipped: li.scrollWidth > li.clientWidth })),
          radius: [style.borderTopLeftRadius, style.borderTopRightRadius],
          button: box(el.querySelector("button")!),
        }
      })
      // Six columns, all inside the bar and the screen, below the centred handle.
      expect(layout.items).toHaveLength(6)
      for (const item of layout.items) {
        expect(item.li.left).toBeGreaterThanOrEqual(0)
        expect(item.li.right).toBeLessThanOrEqual(width)
        expect(item.li.top).toBeGreaterThan(layout.handle.bottom)
        expect(item.li.bottom).toBeLessThanOrEqual(layout.bar.bottom)
        expect(item.clipped).toBe(false)
      }
      expect(Math.abs((layout.handle.left + layout.handle.right) / 2 - width / 2)).toBeLessThanOrEqual(1)
      expect(layout.handle.top).toBeGreaterThan(layout.bar.top)
      // Shaped like the top of a sheet, and the whole bar is the button.
      for (const r of layout.radius) expect(parseFloat(r)).toBeGreaterThan(0)
      // (Inside the bar's 1px top border.)
      expect({ ...layout.button, top: layout.bar.top }).toEqual(layout.bar)
      expect(layout.button.top - layout.bar.top).toBeLessThanOrEqual(1)
      expect(layout.bar.bottom - layout.bar.top).toBeLessThanOrEqual(72)
      // The strength list is still read out, outside the button.
      await expect(page.getByRole("list", { name: "Resource strength", exact: true }).getByRole("listitem")).toHaveCount(6)
      await noOverflow(page)
      await bar.screenshot({ path: `test-results/evidence/game-ui-footer-${width}-${scheme}.png` })

      // A tap opens the same sheet as your own box in the scores.
      await page.getByRole("list", { name: "Standings" }).getByRole("button").first().click()
      const dialog = page.getByRole("dialog")
      await expect(dialog).toBeVisible()
      const fromScores = await dialog.getByRole("heading").first().textContent()
      await page.keyboard.press("Escape")
      await expect(dialog).toHaveCount(0)
      await button.tap()
      await expect(dialog).toBeVisible()
      expect(await dialog.getByRole("heading").first().textContent()).toBe(fromScores)
      expect(fromScores).toBe("Your circle")
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))))
      if (width === 390) await page.screenshot({ path: `test-results/evidence/game-ui-footer-open-${scheme}.png` })
      await page.keyboard.press("Escape")
      await expect(dialog).toHaveCount(0)
      // From the keyboard: Enter and Space open it, and closing returns focus to the bar.
      // (Focused explicitly: Safari does not focus a button that is tapped.)
      await button.focus()
      if (width === 320) await axe(page, `strength footer ${scheme}`)
      for (const key of ["Enter", " "]) {
        await page.keyboard.press(key)
        await expect(dialog).toBeVisible()
        await page.keyboard.press("Escape")
        await expect(dialog).toHaveCount(0)
        await expect(button).toBeFocused()
      }
      await page.context().close()
    })

test("an upward flick on the footer opens your collection; swiping a tier row does not", async ({ browser, browserName }) => {
  test.skip(browserName !== "chromium", "Touch events are dispatched through Chromium's DevTools protocol")
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage()
  await startRoom(page)
  const cdp = await page.context().newCDPSession(page)
  const drag = async (x: number, y0: number, x1: number, y1: number) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y0 }] })
    for (let i = 1; i <= 5; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + ((x1 - x) * i) / 5, y: y0 + ((y1 - y0) * i) / 5 }] })
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    await page.waitForTimeout(400)
  }
  const dialog = page.getByRole("dialog")
  // A sideways swipe along a tier row scrolls the row and opens nothing.
  const strip = page.locator("[data-market-strip]").first()
  await strip.scrollIntoViewIfNeeded()
  const row = (await strip.boundingBox())!
  const scrolls = await syntheticTouchScrolls(page, cdp)
  await cdp.send("Input.synthesizeScrollGesture", { x: row.x + row.width - 20, y: row.y + row.height / 2, xDistance: -200, yDistance: 0, gestureSourceType: "touch", speed: 1200 })
  await page.waitForTimeout(400)
  if (scrolls) expect(await strip.evaluate((s) => s.scrollLeft)).toBeGreaterThan(0)
  else test.info().annotations.push({ type: "unverified", description: "Row scrolling: this Chromium does not scroll for touch swipes synthesised over DevTools" })
  await expect(dialog).toHaveCount(0)
  // A short sideways drag on the footer opens nothing either.
  const bar = (await footer(page).boundingBox())!
  await drag(bar.x + 100, bar.y + bar.height / 2, bar.x + 220, bar.y + bar.height / 2 - 10)
  await expect(dialog).toHaveCount(0)
  // An upward flick does.
  await drag(bar.x + bar.width / 2, bar.y + bar.height / 2, bar.x + bar.width / 2, bar.y - 60)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("heading", { name: "Your circle" })).toBeVisible()
  await noOverflow(page)
  await page.context().close()
})

test("on desktop there is no strength footer; the side panel is unchanged", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: DESKTOP })).newPage()
  await startRoom(page)
  await expect(footer(page)).toBeHidden()
  await expect(page.getByRole("button", { name: OPEN })).toBeHidden()
  await expect(page.locator("aside [data-collection=desktop]").getByRole("list", { name: "Resource strength by kind" })).toBeVisible()
  await page.context().close()
})

for (const [viewport, label] of [[{ width: 320, height: 640 }, "320"], [{ width: 390, height: 844 }, "390"], [DESKTOP, "desktop"]] as const)
  test(`the game page scrolls natively, with full-width header and footer dividers (${label})`, async ({ browser }) => {
    const page = await (await browser.newContext({ viewport, hasTouch: viewport.width < 500 })).newPage()
    await startRoom(page)
    const shell = await page.evaluate(() => {
      const root = document.documentElement
      // Every box between the page and the board: none may scroll the board itself.
      const scrollers: string[] = []
      for (let el = document.querySelector("main")!.parentElement; el && el !== root; el = el.parentElement) {
        const { overflowY } = getComputedStyle(el)
        if (overflowY === "auto" || overflowY === "scroll") scrollers.push(`${el.tagName}.${el.className}`)
      }
      return { scroller: document.scrollingElement === root, scrollers, color: getComputedStyle(root).scrollbarColor, tall: root.scrollHeight > root.clientHeight }
    })
    expect(shell).toEqual({ scroller: true, scrollers: [], color: "auto", tall: true })
    expect(await page.evaluate(() => document.querySelector("[data-radix-scroll-area-viewport]")?.closest("main, header") ?? null)).toBeNull()
    const edges = async () =>
      page.evaluate(() => {
        const width = document.documentElement.clientWidth
        const span = (el: Element | null) => { if (!el || !el.getClientRects().length) return null; const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, line: getComputedStyle(el).borderTopWidth !== "0px" || getComputedStyle(el).borderBottomWidth !== "0px", width } }
        return { header: span(document.querySelector("header")), footer: span(document.querySelector("[data-strength-footer]")), height: innerHeight }
      })
    const check = (e: Awaited<ReturnType<typeof edges>>) => {
      for (const bar of [e.header, e.footer].filter(Boolean)) {
        expect(bar!.line).toBe(true)
        expect(bar!.left).toBe(0)
        expect(bar!.right).toBe(bar!.width)
      }
    }
    const top = await edges()
    check(top)
    expect(!!top.footer).toBe(viewport.width < 1024)
    // Scroll the page natively: the header sticks to the top and the footer to the bottom.
    await page.mouse.move(viewport.width / 2, viewport.height / 2)
    await page.mouse.wheel(0, 600)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
    const scrolled = await edges()
    check(scrolled)
    expect(scrolled.header!.top).toBe(0)
    if (scrolled.footer) expect(Math.round(scrolled.footer.bottom)).toBe(scrolled.height)
    // Tier rows still scroll on their own where the cards do not fit; the page never sideways.
    const strip = page.locator("[data-market-strip]").first()
    await strip.scrollIntoViewIfNeeded()
    if (viewport.width < 500) {
      await strip.evaluate((s) => s.scrollTo({ left: s.scrollWidth }))
      await expect.poll(() => strip.evaluate((s) => s.scrollLeft)).toBeGreaterThan(0)
    }
    expect(await strip.evaluate((s) => getComputedStyle(s).scrollbarColor)).not.toBe("auto")
    expect(await page.evaluate(() => window.scrollX)).toBe(0)
    await noOverflow(page)
    await page.context().close()
  })

/** The heading's or header link's visible title, and whether an icon sits beside it. */
const titleOf = (el: ReturnType<Page["locator"]>) => el.evaluate((e) => ({ text: e.textContent?.trim(), icon: !!e.querySelector("svg") }))
const LONG = "Grand Starfall Academy of Wonder" // the 32-character maximum
const DESCRIPTION = starfallContent().pack.description!
/** A long published description with characters that must stay plain text. */
const NEW_DESCRIPTION = `Students of fire & water, "wind", stone and spark meet at an academy among the stars, bonding with one another across five elements and three years of study, until the brightest earn a place among the masters.`

for (const [viewport, label] of [[{ width: 320, height: 640 }, "320"], [DESKTOP, "desktop"]] as const)
  for (const scheme of SCHEMES)
    test(`home is titled with the default game, before any icon is chosen (${label}, ${scheme})`, async ({ browser }) => {
      const page = await (await browser.newContext({ viewport, colorScheme: scheme })).newPage()
      await page.goto(GAME)
      const heading = page.getByRole("heading", { level: 1 })
      await expect(heading).toHaveText("Starfall Academy")
      expect(await titleOf(heading)).toEqual({ text: "Starfall Academy", icon: false })
      await expect(page).toHaveTitle("Starfall Academy")
      // The default pack's own description introduces it; the platform is credited in the footer.
      await expect(page.locator("main > div > p").first()).toHaveText(DESCRIPTION)
      await expect(page.locator("footer").getByText("Built on Trovekit Game, an open-source card strategy game.")).toBeVisible()
      await noOverflow(page)
      await page.screenshot({ path: `test-results/evidence/game-ui-home-before-${label}-${scheme}.png` })
      await page.context().close()
    })

test("an icon and title chosen in Admin show on home and in new rooms; existing rooms keep their own", async ({ browser }) => {
  const make = async (viewport = { width: 390, height: 844 }) => (await browser.newContext({ viewport })).newPage()
  // Before the change: a waiting room and a started game on the current default.
  const waiting = await make()
  await waiting.goto(GAME)
  await waiting.getByLabel("Your name").fill("Wes")
  await waiting.getByRole("button", { name: "Create room" }).click()
  await expect(waiting.getByRole("button", { name: "Add bot" })).toBeVisible()
  const playing = await make()
  await startRoom(playing)

  // Admin: choose the icon in Settings next to the title, then publish and make it the default.
  const admin = await (await browser.newContext({ viewport: DESKTOP })).newPage()
  await admin.goto(ADMIN)
  await adminNav(admin, "Settings")
  const icon = admin.getByRole("combobox", { name: "Icon" })
  await expect(icon).toHaveText("No icon")
  await icon.click()
  // One of the added icons.
  await admin.getByRole("option", { name: "rectangle circle", exact: true }).click()
  await expect(icon).toHaveText("rectangle circle")
  expect(await icon.locator("svg").count()).toBeGreaterThan(0)
  await admin.getByLabel("Game title").fill(LONG)
  await admin.getByLabel("Description").fill(NEW_DESCRIPTION)
  await axe(admin, "settings icon")
  await admin.locator("main").screenshot({ path: "test-results/evidence/game-ui-admin-icon.png" })
  await adminNav(admin, "Versions")
  await expect(admin.getByText(/icon: none → "rectangle-circle"/)).toBeVisible()
  await admin.getByRole("button", { name: "Publish version" }).click()
  await admin.getByLabel("Note").fill("Star icon")
  await admin.getByRole("button", { name: "Publish", exact: true }).click()
  await admin.getByRole("button", { name: "Make default" }).click()
  await expect(admin.getByText(/New rooms now use/)).toBeVisible()

  // Home shows the new default's title and icon.
  for (const [viewport, label] of [[{ width: 320, height: 640 }, "320"], [DESKTOP, "desktop"]] as const) {
    const home = await make(viewport)
    await home.goto(GAME)
    const heading = home.getByRole("heading", { level: 1 })
    await expect(heading).toHaveText(LONG)
    expect(await titleOf(heading)).toEqual({ text: LONG, icon: true })
    await expect(home).toHaveTitle(LONG)
    // The new default's description, as plain text, wrapped within the page.
    const intro = home.locator("main > div > p").first()
    await expect(intro).toHaveText(NEW_DESCRIPTION)
    expect(await intro.evaluate((p) => p.scrollWidth <= p.clientWidth && p.getClientRects().length > 0 && p.querySelector("*") === null)).toBe(true)
    await noOverflow(home)
    await home.screenshot({ path: `test-results/evidence/game-ui-home-after-${label}.png` })
    await home.context().close()
  }

  // The rooms made before keep their own game, even after a reload.
  for (const page of [waiting, playing]) {
    await page.reload()
    const link = page.locator("header").getByRole("link").first()
    await expect(link).toHaveAccessibleName("Starfall Academy home")
    expect(await titleOf(link)).toEqual({ text: "Starfall Academy", icon: false })
    await expect(page).toHaveTitle("Starfall Academy")
  }
  await expect(waiting.getByText("Starfall Academy · First to")).toBeVisible()

  // A new room uses the new game: in the lobby and in the game header, where at
  // 320px the long title is cut short and the turn status and menu still fit.
  const fresh = await make({ width: 320, height: 640 })
  await fresh.goto(GAME)
  await fresh.getByLabel("Your name").fill("Ana")
  await fresh.getByRole("button", { name: "Create room" }).click()
  await expect(fresh.getByText(`${LONG} · First to`)).toBeVisible()
  expect(await titleOf(fresh.locator("header").getByRole("link").first())).toEqual({ text: LONG, icon: true })
  await fresh.getByRole("button", { name: "Add bot" }).click()
  await fresh.getByRole("button", { name: "Start game" }).click()
  const menu = fresh.getByRole("button", { name: "Game menu" })
  await expect(menu).toBeVisible()
  const header = await fresh.locator("header").first().evaluate((h) => {
    const box = (e: Element) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right } }
    const link = h.querySelector("a")!
    const name = link.querySelector("span")!
    return { link: box(link), menu: box(h.querySelector('button[aria-label="Game menu"]')!), status: box(h.querySelector("[aria-live]")!), cut: name.scrollWidth > name.clientWidth, icon: !!link.querySelector("svg") }
  })
  expect(header.icon).toBe(true)
  expect(header.cut).toBe(true)
  expect(header.link.right).toBeLessThanOrEqual(header.status.left + 0.5)
  expect(header.status.right).toBeLessThanOrEqual(header.menu.left + 0.5)
  expect(header.menu.right).toBeLessThanOrEqual(320)
  await expect(fresh).toHaveTitle(LONG)
  await noOverflow(fresh)
  await axe(fresh, "game header with pack title")
  await fresh.screenshot({ path: "test-results/evidence/game-ui-game-header-320.png" })
  for (const page of [waiting, playing, fresh, admin]) await page.context().close()
})
