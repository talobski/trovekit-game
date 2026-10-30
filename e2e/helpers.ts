import AxeBuilder from "@axe-core/playwright"
import { expect, type APIRequestContext, type Browser, type BrowserContext, type CDPSession, type Page } from "@playwright/test"
import { chooseNormalAction } from "../src/bots/index.ts"
import { createContext, type GameState, type Pack, type Rules } from "../src/engine/index.ts"

export const PHONE = { width: 390, height: 844 }
export const DESKTOP = { width: 1280, height: 900 }

export interface Seat {
  name: string
  context: BrowserContext
  page: Page
}

export async function openRoomUi(browser: Browser, names: string[], viewports: { width: number; height: number }[] = [PHONE]) {
  const seats: Seat[] = []
  for (const [i, name] of names.entries()) {
    const context = await browser.newContext({ viewport: viewports[i % viewports.length] })
    const page = await context.newPage()
    if (i === 0) {
      await page.goto("/")
      await page.getByLabel("Your name").fill(name)
      await page.getByRole("button", { name: "Create room" }).click()
      await page.waitForURL(/\/r\/[A-Z0-9]{6}$/)
      await expect(page.getByRole("button", { name: "Leave room" })).toBeVisible()
    } else {
      await page.goto(seats[0].page.url())
      await page.getByLabel("Your name").fill(name)
      await page.getByRole("button", { name: "Join", exact: true }).click()
      await expect(page.getByText(/Waiting for .* to start/)).toBeVisible()
    }
    seats.push({ name, context, page })
  }
  const code = new URL(seats[0].page.url()).pathname.split("/").pop()!
  for (const s of seats) await expect(seats[0].page.getByText(s.name, { exact: false }).first()).toBeVisible()
  return { seats, code }
}

export async function startGame(seats: Seat[]) {
  await seats[0].page.getByRole("button", { name: "Start game" }).click()
  for (const s of seats) await expect(s.page.getByRole("button", { name: "Game menu" })).toBeVisible()
}

export async function session(page: Page, code: string): Promise<{ playerId: string; token: string }> {
  return page.evaluate((c) => JSON.parse(localStorage.getItem(`trovekit:session:${c}`)!), code)
}

/** Whose turn it is, according to the server. */
export async function activeSeat(request: APIRequestContext, code: string, seats: Seat[]) {
  const s = await session(seats[0].page, code)
  const room = await (await request.get(`/api/rooms/${code}`, { headers: { authorization: `Bearer ${s.token}` } })).json()
  if (room.status !== "playing") return null
  const id = room.game.players[room.game.active].id
  for (const seat of seats) if ((await session(seat.page, code)).playerId === id) return seat
  throw new Error("active seat not found")
}

/** Play one turn through the UI: acquire if a card is affordable, otherwise collect, otherwise reserve or pass. */
/** The turn indicator in the board header (toasts can say "Your turn" a little longer). */
export const myTurn = (page: Page) => page.locator("header").getByText("Your turn", { exact: true })
export const resultHeading = (page: Page) => page.getByRole("heading", { name: /You win|wins|Shared victory/ })

/** The pack's action names; the seeded fixture's (Starfall) unless a theme passes its own. */
export type ActionLabels = { acquire: string; collect: string; reserve: string }
/** Words of the Starfall fixture that e2e/seed.ts installs as the active pack. */
export const FIXTURE = { acquire: "Bond", collect: "Gather", reserve: "Reserve", resources: "Motes", name: "Starfall Academy" } as const
const DEFAULT_LABELS: ActionLabels = FIXTURE

export async function uiTurn(page: Page, labels: ActionLabels = DEFAULT_LABELS): Promise<"acquire" | "collect" | "reserve" | "pass"> {
  await expect(myTurn(page)).toBeVisible()
  const pass = page.getByRole("button", { name: "Pass turn" })
  if (await pass.isVisible()) {
    await pass.click()
    return "pass"
  }
  const affordable = page.locator(`main button[aria-label*="You can ${labels.acquire.toLowerCase()} this now"]:visible`)
  if (await affordable.count()) {
    await affordable.first().click()
    const sheet = page.getByRole("dialog")
    await sheet.getByRole("button", { name: labels.acquire, exact: true }).click()
    await expect(sheet).toBeHidden()
    return "acquire"
  }
  const collect = page.getByRole("button", { name: labels.collect, exact: true }).locator("visible=true")
  if (await collect.isEnabled()) {
    await collect.click()
    const sheet = page.getByRole("dialog")
    const kinds = sheet.locator('button[aria-label*="in supply"]:not([disabled])')
    const n = Math.min(3, await kinds.count())
    for (let i = 0; i < n; i++) await kinds.nth(i).click()
    await sheet.getByRole("button", { name: new RegExp(`^${labels.collect} .+`) }).click()
    await finishDiscard(page)
    await expect(sheet).toBeHidden()
    return "collect"
  }
  await page.locator("main section button[aria-label*='Cost']:visible").first().click()
  const sheet = page.getByRole("dialog")
  await sheet.getByRole("button", { name: new RegExp(`^${labels.reserve}`) }).click()
  await finishDiscard(page)
  await expect(sheet).toBeHidden()
  return "reserve"
}

async function finishDiscard(page: Page) {
  const sheet = page.getByRole("dialog")
  const confirm = sheet.getByRole("button", { name: /and return \d+$/ })
  if (!(await confirm.isVisible({ timeout: 800 }).catch(() => false))) return
  while (!(await sheet.getByText("Ready.").isVisible())) {
    await sheet.getByRole("button", { name: /^Return one more/ }).and(page.locator(":enabled")).first().click()
  }
  await confirm.click()
}

/** Finish the game through the API with bots, using each seat's own session. */
export async function finishWithBots(request: APIRequestContext, code: string, seats: Seat[]) {
  const sessions = await Promise.all(seats.map((s) => session(s.page, code)))
  const auth = (t: string) => ({ authorization: `Bearer ${t}` })
  const content = await (await request.get(`/api/rooms/${code}/content`, { headers: auth(sessions[0].token) })).json()
  const ctx = createContext(content.pack as Pack, content.rules as Rules)
  for (let guard = 0; guard < 1000; guard++) {
    const room = await (await request.get(`/api/rooms/${code}`, { headers: auth(sessions[0].token) })).json()
    if (room.status !== "playing") return room
    const game = room.game
    const me = sessions.find((t) => t.playerId === game.players[game.active].id)!
    const send = (action: unknown) =>
      request.post(`/api/rooms/${code}/actions`, { headers: auth(me.token), data: { actionId: crypto.randomUUID(), expectedRevision: game.revision, action } })
    let res = await send(chooseNormalAction(ctx, game as GameState, `${code}:${game.revision}`))
    if (!res.ok()) {
      const kinds = Object.keys(game.supply.resources).filter((k) => game.supply.resources[k] > 0).slice(0, 3)
      res = await send(kinds.length ? { type: "collect", take: Object.fromEntries(kinds.map((k) => [k, 1])) } : { type: "pass" })
      if (!res.ok() && (await res.json()).code === "DISCARD_REQUIRED") {
        const player = game.players[game.active]
        let need = (await res.json()).details.count
        const resourcesBack: Record<string, number> = {}
        for (const [k, n] of Object.entries(player.resources) as [string, number][]) {
          const t = Math.min(n, need)
          if (t) resourcesBack[k] = t
          need -= t
        }
        res = await send({ type: "collect", take: Object.fromEntries(kinds.map((k) => [k, 1])), discard: { resources: resourcesBack, wildcards: need } })
      }
    }
    expect(res.ok(), await res.text()).toBe(true)
    // Move no faster than every device can show: each one must reach this revision
    // before the next move. Real games are paced by people and bot delays.
    const next = (await res.json()).room
    if (next.status === "playing") {
      for (const s of seats) await expect(s.page.locator("[data-revision]")).toHaveAttribute("data-revision", String(next.game.revision))
    }
  }
  throw new Error("game did not finish")
}

export async function noOverflow(page: Page) {
  const [scroll, inner] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  expect(scroll, "horizontal overflow").toBeLessThanOrEqual(inner)
}

/**
 * Whether this browser scrolls an element for a touch swipe synthesised through
 * Chromium's DevTools protocol. It swipes a plain overflowing box added for the
 * check and removed after it, so "false" describes the browser environment (the
 * first GitHub Linux runs scrolled nothing for these gestures), not the game.
 */
export async function syntheticTouchScrolls(page: Page, cdp: CDPSession): Promise<boolean> {
  await page.evaluate(() => {
    const probe = document.createElement("div")
    probe.id = "touch-scroll-probe"
    probe.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;width:200px;height:120px;overflow-x:auto;background:canvas"
    probe.innerHTML = '<div style="width:1000px;height:120px"></div>'
    document.body.append(probe)
  })
  await cdp.send("Input.synthesizeScrollGesture", { x: 150, y: 60, xDistance: -120, yDistance: 0, gestureSourceType: "touch", speed: 1200 })
  const scrolled = await page.waitForFunction(() => document.getElementById("touch-scroll-probe")!.scrollLeft > 0, undefined, { timeout: 2000 }).then(() => true, () => false)
  await page.evaluate(() => document.getElementById("touch-scroll-probe")!.remove())
  return scrolled
}

async function settle(page: Page) {
  // Scan settled UI: sheets fade and slide in.
  await page.evaluate(() => Promise.all(document.getAnimations().map((x) => x.finished.catch(() => null))))
}

async function scan(label: string, builder: AxeBuilder) {
  const result = await builder.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
  const blocking = result.violations.filter((v) => v.impact === "critical" || v.impact === "serious")
  expect(blocking.map((v) => `${label}: ${v.id} ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")})`)).toEqual([])
}

/**
 * Page scan without the toast stack: sonner fades collapsed toasts behind the front
 * one to opacity 0 by design, which axe reads mid-transition. Toasts get axeToasts.
 */
export async function axe(page: Page, label: string, options: { openListbox?: boolean } = {}) {
  await settle(page)
  let builder = new AxeBuilder({ page: page as never }).exclude("[data-sonner-toaster]")
  // An open Radix Select hides the page with aria-hidden while trapping focus in its listbox.
  // axe only exempts that pattern for role=dialog, so callers prove the trap with a Tab check instead.
  if (options.openListbox) builder = builder.disableRules(["aria-hidden-focus"])
  await scan(label, builder)
}

/** Expand the toast stack (hover shows every toast at full opacity) and scan only the toasts. */
export async function axeToasts(page: Page, label: string) {
  const toast = page.locator("[data-sonner-toast]").first()
  await expect(toast).toBeVisible()
  await toast.hover()
  await settle(page)
  await scan(label, new AxeBuilder({ page: page as never }).include("[data-sonner-toaster]"))
}

/**
 * Admin navigation: Library, a pack, or a section of the open pack, through the
 * sidebar (opening it first on phones, where it is a sheet).
 */
export async function adminNav(page: Page, name: string | RegExp) {
  // Wait for the admin to load, so its layout (sheet or column) is known.
  await expect(page.locator("#page-title")).toBeVisible()
  const nav = page.getByRole("navigation", { name: "Admin" })
  // By layout, not the accessibility tree (dialogs briefly hide the page from it):
  // collapsed on desktop the column sits off-canvas; on phones the sheet is closed.
  const column = page.locator('[data-slot="sidebar-container"]')
  const shown = (await column.count())
    ? await column.evaluate((el) => el.getBoundingClientRect().left >= 0)
    : await page.locator('[data-slot="sidebar"][data-mobile="true"][data-state="open"]').isVisible()
  if (!shown) await page.getByRole("button", { name: "Toggle sidebar" }).click()
  await nav.getByRole("link", { name, exact: typeof name === "string" }).first().click()
  await expect(page.locator("#page-title")).toBeVisible()
  // On phones, wait for the sheet to finish closing.
  await expect(page.locator('[data-slot="sidebar"][data-mobile="true"]')).toHaveCount(0)
}
