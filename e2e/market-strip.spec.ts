import type { APIRequestContext, Locator, Page } from "@playwright/test"
import { expect, test } from "./browser-fixtures"
import { axe, DESKTOP, FIXTURE, myTurn, noOverflow, syntheticTouchScrolls } from "./helpers"
import { ISOLATED_PAIRS } from "./ports"

/*
 * On phones each tier's market row keeps its cards at one readable
 * width and scrolls sideways on its own, and nothing makes the page itself
 * wider than the screen, and the Collect sheet's options keep one size
 * whatever their label and whether chosen. The pack is a worst case: every
 * name at the 48-character limit with no short name, one to five cost kinds,
 * two-digit costs in the top tier, half the cards without artwork, and
 * resource labels from two letters to one 23-letter word. Runs on its own
 * pair, since it changes the default.
 */

test.describe.configure({ mode: "serial" })

const GAME = `http://localhost:${ISOLATED_PAIRS.market}`
const ADMIN = `http://127.0.0.1:${ISOLATED_PAIRS.market + 1}`
const headers = { "x-trovekit-admin": "1" }
const KINDS = ["ember", "tide", "gale", "stone", "spark"]
/** The minimum card width in cards.css (7rem). */
const MIN_CARD = 112
const PHONES = [320, 375, 390]
const SCHEMES = ["light", "dark"] as const
const LABELS = ["Ox", "Extraordinarilylongword", "Very long resource name", "Tide", "Gale"]
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/evidence/market-${name}.png` })

/** Version IDs: the worst case with the pack's resource picture, and without it. */
const versions = { art: "", plain: "" }
test.beforeAll(async ({ request }) => {
  const head = await (await request.get(`${ADMIN}/admin-api/drafts/starfall`, { headers })).json()
  const content = structuredClone(head.content)
  content.pack.version = "1.2.0"
  for (const [i, kind] of content.pack.resourceKinds.entries()) kind.label = LABELS[i]
  for (const group of content.pack.cardGroups) group.cost = { min: 1, max: 60 }
  for (const [i, card] of content.pack.cards.entries()) {
    const top = card.group === content.pack.cardGroups.at(-1).id
    card.name = `${String(i).padStart(2, "0")} ${card.name} of the Long Winding Road Home`.padEnd(48, "x").slice(0, 47) + "x"
    delete card.shortName
    if (i % 2) delete card.art
    card.cost = Object.fromEntries(KINDS.slice(0, top ? 5 : 1 + (i % 5)).map((k, j) => [k, top ? 10 + j : 1]))
  }
  versions.art = await publish(request, content, "worst case")
  const plain = structuredClone(content)
  plain.pack.version = "1.2.1"
  delete plain.pack.resourceArt
  versions.plain = await publish(request, plain, "worst case without resource picture")
  await activate(request, versions.art)
})

async function publish(request: APIRequestContext, content: unknown, note: string) {
  const { revision } = await (await request.get(`${ADMIN}/admin-api/drafts/starfall`, { headers })).json()
  const res = await (await request.post(`${ADMIN}/admin-api/versions`, { headers, data: { content, note, revision } })).json()
  expect(res.ok, JSON.stringify(res.errors ?? res)).toBe(true)
  return res.version.id as string
}
const activate = (request: APIRequestContext, id: string) => request.post(`${ADMIN}/admin-api/active`, { headers, data: { id } })

async function startRoom(page: Page) {
  await page.goto(GAME)
  await page.getByLabel("Your name").fill("Ana")
  await page.getByRole("button", { name: "Create room" }).click()
  await page.getByRole("button", { name: "Add bot" }).click()
  await page.getByRole("button", { name: "Start game" }).click()
  await expect(page.getByRole("button", { name: "Game menu" })).toBeVisible()
}

const tiers = (page: Page) => page.locator("main section.callout-tier")
const strips = (page: Page) => page.locator("[data-market-strip]")
type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number }

/** A strip's scroll metrics and, for every slot, its box and the boxes of what it shows. */
const measure = (strip: Locator) =>
  strip.evaluate((s) => {
    const box = (el: Element | null): Box | null => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
    }
    return {
      scrollLeft: s.scrollLeft,
      scrollWidth: s.scrollWidth,
      clientWidth: s.clientWidth,
      strip: box(s)!,
      more: { start: s.hasAttribute("data-more-start"), end: s.hasAttribute("data-more-end") },
      cards: [...s.children].map((card) => {
        const name = card.querySelector<HTMLElement>(".game-card-bottom > span")
        return {
          card: box(card)!,
          face: box(card.querySelector(".game-card-face")),
          points: box(card.querySelector(".game-card-top .num")),
          name: box(name),
          nameText: name?.textContent ?? "",
          nameEllipsis: !!name && getComputedStyle(name).textOverflow === "ellipsis",
          costs: [...card.querySelectorAll(".game-card-bottom [role=img]")].map((c) => box(c)!),
          /** Cost kinds as the card's accessible description lists them. */
          kinds: (/Cost ([^.]*)\./.exec(card.getAttribute("aria-label") ?? "")?.[1] ?? "").split(", ").filter(Boolean).length,
          art: !!card.querySelector("img"),
        }
      }),
    }
  })

/** The phone column width in cards.css: two and a half cards of the row, at least the minimum. */
const PAD = 6
const GAP = 6
const phoneCard = (clientWidth: number) => Math.max(MIN_CARD, (clientWidth - 2 * PAD - 2 * GAP) / 2.5)

/** Same width and height for every slot, even gaps, no overlap, and every part of each face inside it. */
function expectReadableRow(row: Awaited<ReturnType<typeof measure>>, label: string) {
  const { cards } = row
  expect(cards, label).toHaveLength(4)
  // One width for the row, set by the row alone: names, artwork and costs do not change it.
  const expected = phoneCard(row.clientWidth)
  for (const c of cards) {
    expect(Math.abs(c.card.width - expected), `${label} width`).toBeLessThanOrEqual(0.5)
    expect(Math.abs(c.face!.width - expected), `${label} face width`).toBeLessThanOrEqual(0.5)
    expect(Math.abs(c.card.height - cards[0].card.height), `${label} equal heights`).toBeLessThanOrEqual(0.5)
    expect(c.card.width, `${label} minimum width`).toBeGreaterThanOrEqual(MIN_CARD - 0.5)
  }
  const gaps = cards.slice(1).map((c, i) => c.card.left - cards[i].card.right)
  for (const gap of gaps) {
    expect(gap, `${label} no overlap`).toBeGreaterThan(0)
    expect(Math.abs(gap - gaps[0]), `${label} even gaps`).toBeLessThanOrEqual(0.5)
  }
  for (const [i, c] of cards.entries()) {
    const face = c.face!
    const inside = (b: Box | null, part: string) => {
      expect(b, `${label} card ${i} ${part}`).not.toBeNull()
      expect(b!.left, `${label} card ${i} ${part} left`).toBeGreaterThanOrEqual(face.left - 0.5)
      expect(b!.right, `${label} card ${i} ${part} right`).toBeLessThanOrEqual(face.right + 0.5)
      expect(b!.top, `${label} card ${i} ${part} top`).toBeGreaterThanOrEqual(face.top - 0.5)
      expect(b!.bottom, `${label} card ${i} ${part} bottom`).toBeLessThanOrEqual(face.bottom + 0.5)
    }
    inside(c.points, "points")
    inside(c.name, "name")
    // The 48-character name is cut with an ellipsis, inside the card.
    expect(c.nameText.length, `${label} card ${i} full name`).toBe(48)
    expect(c.nameEllipsis, `${label} card ${i} ellipsis`).toBe(true)
    expect(c.kinds, `${label} card ${i} cost kinds listed`).toBeGreaterThan(0)
    expect(c.costs, `${label} card ${i} cost kinds shown`).toHaveLength(c.kinds)
    for (const [j, cost] of c.costs.entries()) inside(cost, `cost ${j}`)
  }
}

for (const width of PHONES)
  for (const scheme of SCHEMES)
  test(`at ${width}px, every tier row scrolls on its own with equal, readable cards (${scheme})`, async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width, height: 760 }, hasTouch: true, colorScheme: scheme })).newPage()
    await startRoom(page)
    await noOverflow(page)
    const seen = { art: new Set<boolean>(), kinds: new Set<number>() }
    for (let t = 0; t < 3; t++) {
      const tier = tiers(page).nth(t)
      const strip = strips(page).nth(t)
      await tier.scrollIntoViewIfNeeded()
      const heading = tier.getByRole("heading")
      const deck = tier.getByText(/in deck$/)
      const before = { heading: (await heading.boundingBox())!, deck: (await deck.boundingBox())! }
      // The heading and deck count sit inside the screen.
      for (const b of [before.heading, before.deck]) {
        expect(b.x).toBeGreaterThanOrEqual(0)
        expect(b.x + b.width).toBeLessThanOrEqual(width)
      }

      const start = await measure(strip)
      expectReadableRow(start, `${width}px tier ${t + 1}`)
      // Four cards cannot fit: the row scrolls, the page does not.
      expect(start.scrollWidth).toBeGreaterThan(start.clientWidth)
      expect(start.strip.left).toBeGreaterThanOrEqual(0)
      expect(start.strip.right).toBeLessThanOrEqual(width)
      expect(start.more).toEqual({ start: false, end: true })
      expect(start.cards[0].card.left).toBeGreaterThanOrEqual(start.strip.left)
      for (const c of start.cards) {
        seen.art.add(c.art)
        seen.kinds.add(c.kinds)
      }
      // The card at the row's edge is plainly cut off, a quarter to three quarters
      // showing, never a card that merely looks a little narrower than the rest.
      const edge = start.strip.left + start.clientWidth - PAD
      const cut = start.cards.find((c) => c.card.right > edge + 0.5)!
      const showing = (edge - cut.card.left) / cut.card.width
      expect(showing, `${width}px tier ${t + 1} edge card`).toBeGreaterThanOrEqual(0.25)
      expect(showing, `${width}px tier ${t + 1} edge card`).toBeLessThanOrEqual(0.75)

      // Scroll to the end: the last card lies wholly inside the row, at the same size.
      await strip.evaluate((s) => s.scrollTo({ left: s.scrollWidth }))
      await expect.poll(async () => (await measure(strip)).more).toEqual({ start: true, end: false })
      const end = await measure(strip)
      expect(end.scrollLeft).toBeGreaterThanOrEqual(end.scrollWidth - end.clientWidth - 1)
      expectReadableRow(end, `${width}px tier ${t + 1} scrolled`)
      const last = end.cards.at(-1)!.card
      expect(last.left).toBeGreaterThanOrEqual(end.strip.left)
      expect(last.right).toBeLessThanOrEqual(end.strip.right)
      expect(last.right).toBeLessThanOrEqual(width)
      expect(await page.evaluate(() => [window.scrollX, document.documentElement.scrollLeft])).toEqual([0, 0])
      // The heading and deck count stayed where they were.
      expect(await heading.boundingBox()).toEqual(before.heading)
      expect(await deck.boundingBox()).toEqual(before.deck)
      if (t === 2) await shot(page, `${width}-${scheme}-scrolled`)

      // The last card still opens its details after scrolling.
      const lastCard = strip.locator("button.game-card").last()
      const name = (await lastCard.getAttribute("aria-label"))!.split(".")[0]
      await lastCard.tap()
      const dialog = page.getByRole("dialog")
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole("heading", { name })).toBeVisible()
      await noOverflow(page)
      if (t === 2) {
        await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))))
        await shot(page, `${width}-${scheme}-details-after-scroll`)
      }
      await page.keyboard.press("Escape")
      await expect(dialog).toHaveCount(0)
      await strip.evaluate((s) => s.scrollTo({ left: 0 }))
    }
    // The rows mixed cards with and without artwork, and with different numbers of cost kinds.
    expect([...seen.art].sort()).toEqual([false, true])
    expect(seen.kinds.size).toBeGreaterThan(1)
    await tiers(page).first().scrollIntoViewIfNeeded()
    await shot(page, `${width}-${scheme}`)
    await noOverflow(page)
    if (width === 320) await axe(page, `market rows 320 ${scheme}`)
    await page.context().close()
  })

test("a sideways swipe moves only the tier row; the page stays put and still scrolls vertically", async ({ browser, browserName }) => {
  test.skip(browserName !== "chromium", "Touch gestures are synthesised through Chromium's DevTools protocol")
  const page = await (await browser.newContext({ viewport: { width: 375, height: 760 }, hasTouch: true, isMobile: true })).newPage()
  await startRoom(page)
  const cdp = await page.context().newCDPSession(page)
  test.skip(!(await syntheticTouchScrolls(page, cdp)), "This Chromium does not scroll for touch swipes synthesised over DevTools")
  const swipe = async (x: number, y: number, xDistance: number, yDistance: number) => {
    await cdp.send("Input.synthesizeScrollGesture", { x, y, xDistance, yDistance, gestureSourceType: "touch", speed: 1200 })
    await page.waitForTimeout(400)
  }
  const pageScroll = () => page.evaluate(() => ({ x: window.scrollX, y: window.scrollY, docLeft: document.documentElement.scrollLeft }))

  const strip = strips(page).first()
  await strip.scrollIntoViewIfNeeded()
  const box = (await strip.boundingBox())!
  const y0 = (await pageScroll()).y
  // Swipe left inside the first row: the row scrolls, the page does not.
  await swipe(box.x + box.width - 20, box.y + box.height / 2, -240, 0)
  expect(await strip.evaluate((s) => s.scrollLeft)).toBeGreaterThan(0)
  expect(await pageScroll()).toEqual({ x: 0, y: y0, docLeft: 0 })
  // Keep swiping past the row's end: nothing carries over to the page.
  await swipe(box.x + box.width - 20, box.y + box.height / 2, -400, 0)
  expect(await strip.evaluate((s) => s.scrollLeft)).toBeGreaterThanOrEqual(await strip.evaluate((s) => s.scrollWidth - s.clientWidth - 1))
  expect((await pageScroll()).x).toBe(0)
  // A sideways swipe outside the rows does not move the page.
  await page.locator("#achievements").scrollIntoViewIfNeeded()
  const achievements = (await page.locator("#achievements").boundingBox())!
  await swipe(300, achievements.y + 4, -240, 0)
  expect((await pageScroll()).x).toBe(0)
  // The page still scrolls vertically, both ways.
  const y1 = (await pageScroll()).y
  await swipe(180, 400, 0, 300)
  expect((await pageScroll()).y).toBeLessThan(y1)
  await swipe(180, 400, 0, -300)
  expect((await pageScroll()).y).toBeGreaterThan(y0)
  expect((await pageScroll()).x).toBe(0)
  // After the swipe, the visible card nearest the end still opens.
  await strips(page).first().locator("button.game-card").last().tap()
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.context().close()
})

test("keyboard focus scrolls a hidden card into view, and Enter opens it", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 320, height: 760 } })).newPage()
  await startRoom(page)
  const strip = strips(page).first()
  const lastCard = strip.locator("button.game-card").last()
  await lastCard.focus()
  await expect.poll(() => strip.evaluate((s) => s.scrollLeft)).toBeGreaterThan(0)
  const card = (await lastCard.boundingBox())!
  const row = (await strip.boundingBox())!
  expect(card.x + card.width).toBeLessThanOrEqual(row.x + row.width + 0.5)
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.context().close()
})

test("toasts stay inside the screen on a phone", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 375, height: 760 } })).newPage()
  await startRoom(page)
  // Any move announces itself in a toast; ours or the bot's.
  await expect(myTurn(page)).toBeVisible({ timeout: 30_000 })
  await page.getByRole("button", { name: FIXTURE.collect, exact: true }).locator("visible=true").click()
  const sheet = page.getByRole("dialog")
  const kinds = sheet.locator('button[aria-label*="in supply"]:not([disabled])')
  for (let i = 0; i < 3; i++) await kinds.nth(i).click()
  await sheet.getByRole("button", { name: new RegExp(`^${FIXTURE.collect} .+`) }).click()
  const toaster = page.locator("[data-sonner-toaster]")
  await expect(toaster.locator("[data-sonner-toast]").first()).toBeVisible()
  for (const el of [toaster, toaster.locator("[data-sonner-toast]").first()]) {
    const b = (await el.boundingBox())!
    expect(b.x).toBeGreaterThanOrEqual(0)
    expect(b.x + b.width).toBeLessThanOrEqual(375)
  }
  await noOverflow(page)
  await shot(page, "375-toast")
  await page.context().close()
})

test("on desktop all four cards fit: the rows do not scroll and keep the four-column layout", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: DESKTOP })).newPage()
  await startRoom(page)
  for (let t = 0; t < 3; t++) {
    const row = await measure(strips(page).nth(t))
    expect(row.scrollWidth).toBe(row.clientWidth)
    expect(row.more).toEqual({ start: false, end: false })
    // Four equal columns filling the row, as the four-column grid did.
    const gap = 12
    const pad = 6
    const expected = (row.clientWidth - 2 * pad - 3 * gap) / 4
    for (const c of row.cards) expect(Math.abs(c.card.width - expected)).toBeLessThanOrEqual(0.5)
    expect(row.cards[0].card.left - row.strip.left).toBeCloseTo(pad, 0)
    expect(row.strip.right - row.cards[3].card.right).toBeCloseTo(pad, 0)
    // The masks only apply when a row overflows.
    expect(await strips(page).nth(t).evaluate((s) => getComputedStyle(s).maskImage)).toBe("none")
  }
  await noOverflow(page)
  await shot(page, "desktop")
  await page.context().close()
})

/** Every Collect option's own box, and the boxes of its face, label, count and chosen badge. */
const options = (group: Locator) =>
  group.locator(":scope > button").evaluateAll((buttons) =>
    buttons.map((b) => {
      const box = (el: Element | null) => {
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
      }
      const texts = [...b.querySelectorAll("span")].filter((s) => !s.children.length && s.textContent?.trim())
      return {
        pressed: b.getAttribute("aria-pressed") === "true",
        button: box(b)!,
        face: box(b.querySelector(".game-card-face")),
        texts: texts.map((t) => ({ text: t.textContent!, box: box(t)! })),
        overflows: b.scrollWidth > b.clientWidth + 0.5,
        /** Anything drawn around the option, such as a ring outside its edge. */
        shadow: getComputedStyle(b).boxShadow,
      }
    }),
  )

for (const width of PHONES)
  for (const scheme of SCHEMES)
    for (const art of [true, false])
      test(`at ${width}px the Collect options keep one width, chosen or not, whatever their label (${art ? "picture" : "no picture"}, ${scheme})`, async ({ browser, request }) => {
        await activate(request, art ? versions.art : versions.plain)
        const page = await (await browser.newContext({ viewport: { width, height: 760 }, hasTouch: true, colorScheme: scheme })).newPage()
        await startRoom(page)
        await expect(myTurn(page)).toBeVisible({ timeout: 30_000 })
        await page.getByRole("button", { name: FIXTURE.collect, exact: true }).locator("visible=true").click()
        const dialog = page.getByRole("dialog")
        const group = dialog.getByRole("group", { name: "Supply" })
        await expect(group).toBeVisible()
        await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))))

        const check = (list: Awaited<ReturnType<typeof options>>, state: string) => {
          expect(list, state).toHaveLength(5)
          // Three equal columns: every option is exactly one column wide.
          const groupWidth = list[2].button.right - list[0].button.left
          const column = (groupWidth - 2 * (list[1].button.left - list[0].button.right)) / 3
          for (const [i, o] of list.entries()) {
            const label = `${state} option ${i} (${LABELS[i]})`
            expect(Math.abs(o.button.width - column), `${label} width`).toBeLessThanOrEqual(0.5)
            expect(Math.abs(o.button.height - list[0].button.height), `${label} height`).toBeLessThanOrEqual(0.5)
            if (art) expect(Math.abs(o.face!.width - o.button.width), `${label} picture width`).toBeLessThanOrEqual(0.5)
            expect(o.overflows, `${label} overflow`).toBe(false)
            // The name (wrapped if long), the count left and the chosen badge all lie inside the option.
            expect(o.texts.map((t) => t.text)).toContain(LABELS[i])
            for (const t of o.texts) {
              expect(t.box.left, `${label} "${t.text}" left`).toBeGreaterThanOrEqual(o.button.left - 0.5)
              expect(t.box.right, `${label} "${t.text}" right`).toBeLessThanOrEqual(o.button.right + 0.5)
              expect(t.box.top, `${label} "${t.text}" top`).toBeGreaterThanOrEqual(o.button.top - 0.5)
              expect(t.box.bottom, `${label} "${t.text}" bottom`).toBeLessThanOrEqual(o.button.bottom + 0.5)
            }
          }
        }

        const before = await options(group)
        check(before, "unchosen")
        // Choose the long single word and a short one.
        await group.getByRole("button", { name: new RegExp(`^${LABELS[1]},`) }).click()
        await group.getByRole("button", { name: new RegExp(`^${LABELS[0]},`) }).click()
        const after = await options(group)
        expect(after.filter((o) => o.pressed)).toHaveLength(2)
        check(after, "chosen")
        // Choosing resized and rearranged nothing. (The sheet itself may move up as its footer text changes.)
        const layout = (list: typeof before) => list.map((o) => ({ left: o.button.left, top: o.button.top - list[0].button.top, width: o.button.width, height: o.button.height }))
        expect(layout(after)).toEqual(layout(before))
        // Nor is anything drawn outside a chosen option's edge: it looks exactly as wide as the rest.
        expect(new Set(after.map((o) => o.shadow)).size).toBe(1)
        expect(await dialog.evaluate((d) => d.scrollWidth <= d.clientWidth)).toBe(true)
        await noOverflow(page)
        await shot(page, `collect-${width}-${art ? "picture" : "plain"}-${scheme}`)
        await page.context().close()
        await activate(request, versions.art)
      })
