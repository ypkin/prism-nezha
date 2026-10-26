import { chromium } from "@playwright/test"
import { fileURLToPath } from "node:url"

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light", reducedMotion: "reduce" })
  await page.goto("http://127.0.0.1:4173")
  await page.getByRole("button", { name: "查看 Tokyo 详情", exact: true }).waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: fileURLToPath(new URL("../preview.png", import.meta.url)), animations: "disabled" })
  console.log("preview.png captured from the actual UI using synthetic public telemetry")
} finally {
  await browser.close()
}
