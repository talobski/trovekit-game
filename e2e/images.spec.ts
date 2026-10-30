import { test, expect } from "./browser-fixtures"
import sharp from "sharp"
import { adminNav, axe, noOverflow } from "./helpers"

for (const width of [390, 1280]) test(`card artwork upload, review and fallback at ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  const buffer = await sharp({ create: { width: 120, height: 150, channels: 3, background: "#555555" } }).png().toBuffer()
  await page.goto("http://127.0.0.1:5281")
  await adminNav(page, "Cards")
  await page.getByRole("button", { name: /Aria Ashgrove/ }).click()
  await page.getByLabel("Card image file", { exact: true }).setInputFiles({ name: "aria-ashgrove.png", mimeType: "image/png", buffer })
  await expect(page.getByRole("button", { name: "Replace image" })).toBeVisible()
  await expect(page.getByRole("dialog").getByRole("img", { name: "Aria Ashgrove", exact: true })).toBeVisible()
  await page.getByLabel("Creator / rights holder").fill("Test author")
  await page.getByLabel("License / permission").fill("Original test art")
  await noOverflow(page)
  await axe(page, "image editor")
  await page.getByRole("button", { name: "Remove image" }).click()
  await expect(page.getByRole("img", { name: "Aria Ashgrove, no image" })).toBeVisible()
  await page.keyboard.press("Escape")
  await page.getByLabel("Bulk image files").setInputFiles([
    { name: "aria-ashgrove.png", mimeType: "image/png", buffer },
    { name: "unknown-card.png", mimeType: "image/png", buffer },
    { name: "bram-ashgrove.png", mimeType: "image/png", buffer },
    { name: "BRAM-ASHGROVE.PNG", mimeType: "image/png", buffer },
  ])
  await expect(page.getByRole("heading", { name: "Review images" })).toBeVisible()
  await expect(page.getByText("Unmatched", { exact: true })).toBeVisible()
  await expect(page.getByText("Duplicate ID", { exact: true })).toHaveCount(2)
  await noOverflow(page)
  await axe(page, "bulk review")
  await page.getByRole("button", { name: "Apply valid matches" }).click()
  await adminNav(page, "Preview")
  const img = page.getByRole("img", { name: "Aria Ashgrove", exact: true })
  await expect(img).toBeVisible()
  await expect(img).toHaveJSProperty("naturalWidth", 480)
})
