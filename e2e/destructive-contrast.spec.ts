import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Locator, type Page } from "./browser-fixtures"
import { adminNav, DESKTOP, openRoomUi, PHONE, startGame } from "./helpers"

const ADMIN = "http://127.0.0.1:5281"
const THEMES = ["light", "dark"] as const

/**
 * Destructive actions keep AA text contrast at rest, on hover and on keyboard
 * focus, in both themes. Only hovers and focuses; nothing is deleted.
 */
async function expectContrast(page: Page, button: Locator, state: string) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((x) => x.finished.catch(() => null))))
  await button.evaluate((el) => el.setAttribute("data-contrast-target", ""))
  const result = await new AxeBuilder({ page: page as never }).include("[data-contrast-target]").withRules(["color-contrast"]).analyze()
  await button.evaluate((el) => el.removeAttribute("data-contrast-target"))
  expect(result.violations.flatMap((v) => v.nodes.map((n) => `${state}: ${n.failureSummary}`))).toEqual([])
  if (result.passes.some((r) => r.id === "color-contrast" && r.nodes.length)) return
  // axe leaves the phone drawer for review (vaul gives it a pseudo element), so measure it here.
  const ratio = await button.evaluate(measuredContrast)
  expect(ratio, `${state}: measured contrast`).toBeGreaterThanOrEqual(4.5)
}

/** WCAG contrast of the element's text on its painted background (ancestor backgrounds composited). */
function measuredContrast(el: Element) {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!
  const rgba = (css: string) => {
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = css
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return [r / 255, g / 255, b / 255, a / 255]
  }
  const layers: number[][] = []
  for (let node: Element | null = el; node; node = node.parentElement) {
    const bg = rgba(getComputedStyle(node).backgroundColor)
    if (bg[3] > 0) layers.push(bg)
    if (bg[3] === 1) break
  }
  let bg = [1, 1, 1]
  for (const [r, g, b, a] of layers.reverse()) bg = [r, g, b].map((v, i) => v * a + bg[i] * (1 - a))
  const [fr, fg, fb, fa] = rgba(getComputedStyle(el).color)
  const text = [fr, fg, fb].map((v, i) => v * fa + bg[i] * (1 - fa))
  const lum = (c: number[]) => {
    const [r, g, b] = c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [hi, lo] = [lum(text), lum(bg)].sort((a, b) => b - a)
  return (hi + 0.05) / (lo + 0.05)
}

async function checkStates(page: Page, button: Locator, name: string) {
  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme })
    await page.mouse.move(0, 0)
    await expectContrast(page, button, `${name} ${theme} rest`)
    await button.hover()
    await expectContrast(page, button, `${name} ${theme} hover`)
    // Keyboard focus: reach the button by Tab so :focus-visible applies, and keep the ring.
    await page.mouse.move(0, 0)
    await button.focus()
    await page.keyboard.press("Shift+Tab")
    await page.keyboard.press("Tab")
    await expect(button).toBeFocused()
    expect(await button.evaluate((el) => el.matches(":focus-visible") && getComputedStyle(el).boxShadow !== "none"), `${name} ${theme} focus ring`).toBe(true)
    await expectContrast(page, button, `${name} ${theme} focus`)
  }
  await page.emulateMedia({ colorScheme: "light" })
}

for (const viewport of [PHONE, DESKTOP]) {
  const label = viewport === PHONE ? "phone" : "desktop"

  test(`admin delete actions keep text contrast (${label})`, async ({ browser }) => {
    const page = await (await browser.newContext({ viewport })).newPage()
    await page.goto(ADMIN)
    const sheets = [
      { section: "Cards", row: /Aria Ashgrove/, action: "Delete card" },
      { section: "Achievements", row: /Tidecallers/, action: "Delete achievement" },
      { section: "Relationships", row: /Aria Ashgrove and Bram Ashgrove/, action: "Delete relationship" },
    ]
    for (const { section, row, action } of sheets) {
      await adminNav(page, section)
      await page.getByRole("button", { name: row }).first().click()
      const button = page.getByRole("dialog").getByRole("button", { name: action })
      await checkStates(page, button, action)
      await page.keyboard.press("Escape")
      await expect(page.getByRole("dialog")).toBeHidden()
      // Still there: the checks never trigger the action.
      await expect(page.getByRole("button", { name: row }).first()).toBeVisible()
    }
  })

  test(`ending the game keeps text contrast and its confirmation (${label})`, async ({ browser }) => {
    const { seats } = await openRoomUi(browser, ["Ana", "Ben"], [viewport])
    await startGame(seats)
    const page = seats[0].page
    await page.getByRole("button", { name: "Game menu" }).click()
    const end = page.getByRole("dialog").getByRole("button", { name: "End game for everyone" })
    await checkStates(page, end, "End game for everyone")

    await end.click()
    const confirm = page.getByRole("alertdialog")
    await expect(confirm.getByRole("heading", { name: "End this game?" })).toBeVisible()
    await checkStates(page, confirm.getByRole("button", { name: "End game", exact: true }), "End game")
    await confirm.getByRole("button", { name: "Keep playing" }).click()
    await expect(confirm).toBeHidden()
    // Cancelling keeps the game going for everyone.
    await page.keyboard.press("Escape")
    for (const s of seats) await expect(s.page.getByRole("button", { name: "Game menu" })).toBeVisible()
  })
}
