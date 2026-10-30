import type { APIRequestContext, Page } from "@playwright/test"
import { expect, test } from "./browser-fixtures"
import { starfallContent } from "../tests/fixtures/starfall"
import { axe, DESKTOP, FIXTURE, myTurn, noOverflow, PHONE } from "./helpers"
import { ISOLATED_PAIRS } from "./ports"

/*
 * Cards without artwork take a dark shade of their tier's tone, card
 * details use the theme border whatever the tier, and Resource strength is
 * sorted strongest first with zeros at half opacity, in the side panel and in
 * the phone's bottom bar. Runs on its own pair, since it changes the default.
 */

test.describe.configure({ mode: "serial" })

const GAME = `http://localhost:${ISOLATED_PAIRS.gameplay}`
const ADMIN = `http://127.0.0.1:${ISOLATED_PAIRS.gameplay + 1}`
const headers = { "x-trovekit-admin": "1" }
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/evidence/gameplay-${name}.png` })

/** Publish `content` and make it the default, returning the version ID. */
async function publishDefault(request: APIRequestContext, content: unknown, note: string) {
  const head = await (await request.get(`${ADMIN}/admin-api/drafts/starfall`, { headers })).json()
  const res = await (await request.post(`${ADMIN}/admin-api/versions`, { headers, data: { content, note, revision: head.revision } })).json()
  expect(res.ok).toBe(true)
  await request.post(`${ADMIN}/admin-api/active`, { headers, data: { id: res.version.id } })
  return res.version.id as string
}
async function activate(request: APIRequestContext, note: string) {
  const list = await (await request.get(`${ADMIN}/admin-api/content`, { headers })).json()
  await request.post(`${ADMIN}/admin-api/active`, { headers, data: { id: list.versions.find((v: { note: string }) => v.note === note).id } })
}

async function startRoom(page: Page) {
  await page.goto(GAME)
  await page.getByLabel("Your name").fill("Ana")
  await page.getByRole("button", { name: "Create room" }).click()
  await page.getByRole("button", { name: "Add bot" }).click()
  await page.getByRole("button", { name: "Start game" }).click()
  await expect(page.getByRole("button", { name: "Game menu" })).toBeVisible()
}

/** The first market card in each tier row. */
const tierCards = (page: Page) => [0, 1, 2].map((i) => page.locator("main section.callout-tier").nth(i).locator("button.game-card").first())
const faceBackground = (card: ReturnType<Page["locator"]>) => card.locator(".game-card-face").evaluate((el) => getComputedStyle(el).backgroundColor)
/** The colour a CSS expression resolves to on this page. */
const resolve = (page: Page, property: "backgroundColor" | "borderTopColor", className: string, style = "") =>
  page.evaluate(({ property, className, style }) => {
    const el = document.createElement("div")
    el.className = className
    el.setAttribute("style", style)
    document.body.append(el)
    const value = getComputedStyle(el)[property]
    el.remove()
    return value
  }, { property, className, style })

/** On the player's first turn, collect the last three kinds in the pack's order, so sorting visibly moves them first. */
async function collectLastKinds(page: Page) {
  await expect(myTurn(page)).toBeVisible({ timeout: 30_000 })
  await page.getByRole("button", { name: FIXTURE.collect, exact: true }).locator("visible=true").click()
  const sheet = page.getByRole("dialog")
  const kinds = sheet.locator('button[aria-label*="in supply"]:not([disabled])')
  const n = await kinds.count()
  for (let i = n - 1; i >= n - 3; i--) await kinds.nth(i).click()
  await sheet.getByRole("button", { name: new RegExp(`^${FIXTURE.collect} .+`) }).click()
  await expect(sheet).toBeHidden()
}

/** A column list's ids and totals, in display order, from its accessible names. */
const columns = (list: ReturnType<Page["locator"]>) =>
  list.locator("li").evaluateAll((items) => items.map((li) => ({ id: li.getAttribute("data-strength"), total: Number(/: (\d+)/.exec(li.getAttribute("aria-label") ?? "")?.[1]), opacity: getComputedStyle(li).opacity })))
const CONFIGURED = [...starfallContent().pack.resourceKinds.map((k) => k.id), "wild"]
function expectSorted(cols: { id: string | null; total: number; opacity: string }[]) {
  expect(cols.map((c) => c.id).sort()).toEqual([...CONFIGURED].sort())
  for (let i = 1; i < cols.length; i++) {
    const [a, b] = [cols[i - 1], cols[i]]
    expect(a.total > b.total || (a.total === b.total && CONFIGURED.indexOf(a.id!) < CONFIGURED.indexOf(b.id!)), `${a.id} before ${b.id}`).toBe(true)
  }
  for (const c of cols) expect(c.opacity, `${c.id} opacity`).toBe(c.total ? "1" : "0.5")
}

for (const scheme of ["light", "dark"] as const)
  test(`cards without artwork take their tier's tone; cards with artwork are unchanged (${scheme})`, async ({ browser, request }) => {
    const plain = starfallContent()
    plain.pack.version = "1.1.0"
    for (const card of plain.pack.cards) delete card.art
    if (scheme === "light") await publishDefault(request, plain, "no artwork")
    else await activate(request, "no artwork")
    const page = await (await browser.newContext({ viewport: DESKTOP, colorScheme: scheme })).newPage()
    await startRoom(page)
    const scrim = await resolve(page, "backgroundColor", "", "background: var(--photo-scrim)")
    const tones = []
    for (const [i, card] of tierCards(page).entries()) {
      await expect(card.locator(".card-photo-empty")).toHaveCount(1)
      const expected = await resolve(page, "backgroundColor", "", `background: color-mix(in oklab, var(--tone-${["teal", "amber", "violet"][i]}) 30%, var(--photo-scrim))`)
      const bg = await faceBackground(card)
      expect(bg).toBe(expected)
      expect(bg).not.toBe(scrim)
      tones.push(bg)
    }
    expect(new Set(tones).size).toBe(3)
    await axe(page, `cards without artwork ${scheme}`)
    await page.locator("main section.callout-tier").first().scrollIntoViewIfNeeded()
    await page.screenshot({ path: `test-results/evidence/gameplay-no-art-${scheme}.png`, fullPage: true })

    // The same game with artwork: the photo presentation, untouched.
    await activate(request, "e2e fixture")
    const art = await (await browser.newContext({ viewport: DESKTOP, colorScheme: scheme })).newPage()
    await startRoom(art)
    for (const card of tierCards(art)) {
      await expect(card.locator(".card-photo-empty")).toHaveCount(0)
      await expect(card.locator("img")).toHaveCount(1)
      expect(await faceBackground(card)).toBe(scrim)
    }
    await art.screenshot({ path: `test-results/evidence/gameplay-with-art-${scheme}.png`, fullPage: true })
    await activate(request, "no artwork")
    await page.context().close(); await art.context().close()
  })

for (const [viewport, label] of [[DESKTOP, "desktop"], [PHONE, "phone"]] as const)
  for (const scheme of ["light", "dark"] as const)
    test(`card details use the theme border for every tier (${label}, ${scheme})`, async ({ browser }) => {
      const page = await (await browser.newContext({ viewport, colorScheme: scheme })).newPage()
      await startRoom(page)
      const border = await resolve(page, "borderTopColor", "border")
      for (const [i, card] of tierCards(page).entries()) {
        await card.click()
        const dialog = page.getByRole("dialog")
        await expect(dialog).toBeVisible()
        expect(await dialog.evaluate((el) => getComputedStyle(el).borderTopColor), `tier ${i + 1}`).toBe(border)
        expect(await dialog.evaluate((el) => [...el.classList].some((c) => c.startsWith("callout-tier")))).toBe(false)
        if (i === 0) await axe(page, `card details ${label} ${scheme}`)
        // Let the dialog finish appearing before the screenshot.
        await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))))
        await shot(page, `details-tier-${i + 1}-${label}-${scheme}`)
        await page.keyboard.press("Escape")
        await expect(dialog).toHaveCount(0)
      }
      // Keyboard: a market card still shows its focus ring and opens with Enter.
      const first = tierCards(page)[0]
      await first.focus()
      expect(await first.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none")
      await page.keyboard.press("Enter")
      await expect(page.getByRole("dialog")).toBeVisible()
      await page.context().close()
    })

test("Resource strength is sorted strongest first, with zeros at half opacity, and follows the game", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: DESKTOP })).newPage()
  await startRoom(page)
  const strength = page.locator("aside [data-collection=desktop]").getByRole("list", { name: "Resource strength by kind" })
  // Nothing held yet: configured order, wildcards last, all at half opacity.
  const initial = await columns(strength)
  expect(initial.map((c) => c.id)).toEqual(CONFIGURED)
  expectSorted(initial)
  await shot(page, "strength-desktop-start")
  // Collect the last three kinds: the order follows.
  await collectLastKinds(page)
  await expect.poll(async () => (await columns(strength))[0].total).toBeGreaterThan(0)
  const after = await columns(strength)
  expectSorted(after)
  expect(after.map((c) => c.id)).not.toEqual(CONFIGURED)
  await strength.scrollIntoViewIfNeeded()
  await axe(page, "strength desktop")
  await page.locator("aside [data-collection=desktop]").screenshot({ path: "test-results/evidence/gameplay-strength-desktop.png" })
  await page.context().close()
})

for (const scheme of ["light", "dark"] as const)
  test(`the phone's bottom bar shows the same Resource strength, compactly (${scheme})`, async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: PHONE, colorScheme: scheme })).newPage()
    await startRoom(page)
    const strip = page.getByRole("list", { name: "Resource strength", exact: true })
    const full = page.locator("[data-collection=mobile]").getByRole("list", { name: "Resource strength by kind" })
    await collectLastKinds(page)
    await expect.poll(async () => (await columns(strip))[0].total).toBeGreaterThan(0)
    const compact = await columns(strip)
    expectSorted(compact)
    // Same values, same order as the full view.
    expect(compact.map(({ id, total }) => ({ id, total }))).toEqual((await columns(full)).map(({ id, total }) => ({ id, total })))
    // Compact: one row of icons and totals, no bars.
    const bar = page.locator("div.fixed.bottom-0")
    const box = (await bar.boundingBox())!
    expect(box.height).toBeLessThanOrEqual(72)
    await expect(bar.locator(".recharts-wrapper")).toHaveCount(0)
    const rows = await strip.locator("li").evaluateAll((items) => new Set(items.map((li) => Math.round(li.getBoundingClientRect().top))).size)
    expect(rows).toBe(1)
    await expect(strip).toBeInViewport()
    // Nothing is hidden behind it: the end of the page scrolls clear of the bar.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    const lastBottom = await page.locator("main").evaluate((main) => Math.max(...[...main.querySelectorAll("button, a, h2, li")].map((el) => el.getBoundingClientRect().bottom)))
    expect(lastBottom).toBeLessThanOrEqual(box.y + 1)
    await noOverflow(page)
    await axe(page, `strength strip ${scheme}`)
    await page.screenshot({ path: `test-results/evidence/gameplay-strength-phone-${scheme}.png` })
    await page.context().close()
  })

/** Two-digit totals for every column, shown to the page only: the server's game is untouched. */
const BIG = { ember: 12, tide: 11, gale: 10, stone: 13, spark: 14 }
function inflate(room: { game?: { players: { resources: Record<string, number>; wildcards: number }[] } }) {
  for (const p of room.game?.players ?? []) {
    p.resources = { ...BIG }
    p.wildcards = 10
  }
  return room
}
async function showTwoDigitTotals(page: Page) {
  await page.routeWebSocket(/\/ws$/, (ws) => {
    const server = ws.connectToServer()
    server.onMessage((message) => {
      const msg = JSON.parse(String(message))
      ws.send(JSON.stringify(msg.type === "room" ? { ...msg, room: inflate(msg.room) } : msg))
    })
  })
  await page.route(/\/api\/rooms\/[A-Z0-9]{6}$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    const response = await route.fetch()
    await route.fulfill({ response, json: inflate(await response.json()) })
  })
}

/** Every column of the strip, its icon and its number lie fully inside the viewport and the bar, unclipped. */
async function expectStripFits(page: Page, width: number) {
  const strip = page.getByRole("list", { name: "Resource strength", exact: true })
  const bar = (await page.locator("div.fixed.bottom-0").boundingBox())!
  const items = await strip.locator("li").evaluateAll((lis) =>
    lis.map((li) => {
      const [icon, number] = [li.children[0] as HTMLElement, li.children[1] as HTMLElement]
      const box = (el: Element) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom } }
      return { li: box(li), icon: box(icon), number: box(number), text: number.textContent, clipped: number.scrollWidth > number.clientWidth || li.scrollWidth > li.clientWidth }
    }),
  )
  expect(items).toHaveLength(6)
  for (const [i, item] of items.entries()) {
    for (const part of [item.li, item.icon, item.number]) {
      expect(part.left, `item ${i} left`).toBeGreaterThanOrEqual(0)
      expect(part.right, `item ${i} right`).toBeLessThanOrEqual(width)
      expect(part.top, `item ${i} top`).toBeGreaterThanOrEqual(bar.y)
      expect(part.bottom, `item ${i} bottom`).toBeLessThanOrEqual(bar.y + bar.height)
    }
    // The number sits inside its column, beside its icon, without being cut.
    expect(item.number.right).toBeLessThanOrEqual(item.li.right + 0.5)
    expect(item.number.left).toBeGreaterThanOrEqual(item.icon.right)
    expect(item.clipped, `item ${i} clipped`).toBe(false)
  }
  expect(await strip.evaluate((ul) => ul.scrollWidth <= ul.clientWidth)).toBe(true)
  expect(new Set(items.map((item) => Math.round(item.li.top))).size).toBe(1)
  await noOverflow(page)
  return items
}

test("at 320px, six two-digit totals fit the phone's bottom bar, in order and unclipped", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 320, height: 640 } })).newPage()
  await showTwoDigitTotals(page)
  await startRoom(page)
  const strip = page.getByRole("list", { name: "Resource strength", exact: true })
  await expect.poll(async () => (await columns(strip)).map((c) => c.total)).toEqual([14, 13, 12, 11, 10, 10])
  const cols = await columns(strip)
  expect(cols.map((c) => c.id)).toEqual(["spark", "stone", "ember", "tide", "gale", "wild"])
  expectSorted(cols)
  const items = await expectStripFits(page, 320)
  expect(items.map((item) => item.text)).toEqual(["14", "13", "12", "11", "10", "10"])
  await axe(page, "strength strip 320 two digits")
  await page.screenshot({ path: "test-results/evidence/gameplay-strength-phone-320-two-digits.png" })
  await page.context().close()
})

for (const width of [320, 390])
  test(`at ${width}px, ordinary totals fit the phone's bottom bar`, async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width, height: 700 } })).newPage()
    await startRoom(page)
    await collectLastKinds(page)
    const strip = page.getByRole("list", { name: "Resource strength", exact: true })
    await expect.poll(async () => (await columns(strip))[0].total).toBeGreaterThan(0)
    expectSorted(await columns(strip))
    await expectStripFits(page, width)
    await page.screenshot({ path: `test-results/evidence/gameplay-strength-phone-${width}.png` })
    await page.context().close()
  })
