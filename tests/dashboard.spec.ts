import { test, expect } from "@playwright/test"
import { history, nodes } from "./fixtures.mjs"

test("blocked site storage keeps the list, theme toggle and monitoring usable", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() { throw new DOMException("Site data disabled", "SecurityError") },
    })
  })
  await page.emulateMedia({ colorScheme: "dark" })
  await page.goto("/")
  await expect(page.getByRole("button", { name: "查看 Tokyo 详情", exact: true })).toBeVisible()
  await expect(page.locator("html")).toHaveClass(/dark/)
  await page.emulateMedia({ colorScheme: "light" })
  await expect(page.locator("html")).not.toHaveClass(/dark/)
  await page.getByRole("button", { name: "切换主题", exact: true }).click()
  await expect(page.locator("html")).toHaveClass(/dark/)
  await page.getByRole("button", { name: "按CPU排序", exact: true }).click()
  await expect(page.getByLabel("服务器排序")).toHaveValue("cpu")
  await page.locator("nav").getByRole("link", { name: "监控", exact: true }).click()
  await expect(page.locator(".monitor-chart-card")).toHaveCount(5)
  await expect(page.locator(".monitor-chart-card .recharts-surface").first()).toBeVisible()
  expect(errors).toEqual([])
})

test("full storage still allows changing the theme for this tab", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.addInitScript(() => {
    localStorage.setItem("theme", "dark")
    Storage.prototype.setItem = () => { throw new DOMException("Storage full", "QuotaExceededError") }
  })
  await page.goto("/")
  await expect(page.locator("html")).toHaveClass(/dark/)
  await page.getByRole("button", { name: "切换主题", exact: true }).click()
  await expect(page.locator("html")).not.toHaveClass(/dark/)
  await page.emulateMedia({ colorScheme: "dark" })
  await expect(page.locator("html")).not.toHaveClass(/dark/)
  await page.getByRole("button", { name: "切换主题", exact: true }).click()
  await expect(page.locator("html")).toHaveClass(/dark/)
  expect(errors).toEqual([])
})

test("search, empty state and status filters preserve the fleet summary", async ({ page }) => {
  await page.goto("/")
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/favicon.svg")
  const icon = await page.request.get("/favicon.svg")
  expect(icon.ok()).toBe(true)
  expect(icon.headers()["content-type"]).toContain("image/svg+xml")
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/apple-touch-icon.png")
  const touchIcon = await page.request.get("/apple-touch-icon.png")
  expect(touchIcon.ok()).toBe(true)
  expect(touchIcon.headers()["content-type"]).toContain("image/png")
  await expect(page.getByRole("heading", { name: "服务器", exact: true })).toHaveCount(0)
  await expect(page.locator("footer")).toHaveCount(0)
  await expect(page.getByText(/显示 \d+ \/ \d+ 台服务器/)).toHaveCount(0)
  await expect(page.getByRole("button", { name: /^查看 .+ 详情$/ })).toHaveCount(6)
  await page.getByRole("searchbox", { name: "搜索服务器" }).fill("日本 Debian")
  await expect(page.getByRole("button", { name: /^查看 .+ 详情$/ })).toHaveCount(1)
  await expect(page.getByRole("button", { name: "查看 Tokyo 详情", exact: true })).toBeVisible()
  await expect(page.locator(".server-summary-card")).toContainText("6 / 6")
  await page.getByRole("searchbox").fill("no-such-node")
  await expect(page.getByText("没有符合条件的服务器")).toBeVisible()
  await page.getByRole("button", { name: "清除筛选", exact: true }).first().click()
  await page.getByRole("button", { name: "离线 0", exact: true }).click()
  await expect(page.getByText("没有符合条件的服务器")).toBeVisible()
  await page.getByRole("button", { name: "全部 6", exact: true }).click()
  await expect(page.getByRole("button", { name: /^查看 .+ 详情$/ })).toHaveCount(6)
})

test("metric sort and direction survive a reload", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "按CPU排序", exact: true }).click()
  await expect(page.getByRole("button", { name: /^查看 .+ 详情$/ }).first()).toHaveAccessibleName("查看 Los Angeles 详情")
  await page.reload()
  await expect(page.getByLabel("服务器排序")).toHaveValue("cpu")
  await expect(page.getByRole("button", { name: /^查看 .+ 详情$/ }).first()).toHaveAccessibleName("查看 Los Angeles 详情")
  await page.getByRole("button", { name: "当前降序，切换为升序" }).click()
  await expect(page.getByRole("button", { name: /^查看 .+ 详情$/ }).first()).toHaveAccessibleName("查看 Sydney 详情")
})

test("drawer traps focus, closes with Escape and restores the filtered list", async ({ page }) => {
  const pingRequests: string[] = []
  page.on("request", (request) => { if (request.url().includes("series=ping")) pingRequests.push(request.url()) })
  await page.goto("/")
  await page.getByRole("searchbox").fill("Tokyo")
  const opener = page.getByRole("button", { name: "查看 Tokyo 详情", exact: true })
  await opener.click()
  const dialog = page.getByRole("dialog", { name: "Tokyo 详情", exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText("节点详情", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "关闭详情", exact: true })).toBeFocused()
  await expect(dialog.getByText("系统信息", { exact: true })).toBeVisible()
  await expect(dialog.getByText("网络与连接", { exact: true })).toBeVisible()
  await expect(dialog.locator(".recharts-surface").first()).toBeVisible()
  await expect(dialog.getByText("网络延迟 · 最近 1 小时")).toBeVisible()
  await expect.poll(() => pingRequests.some((url) => new URL(url).searchParams.get("hours") === "1")).toBe(true)
  await expect(dialog.getByRole("link", { name: "查看资源图表" })).toHaveCount(1)
  await expect(dialog.getByRole("link", { name: "查看完整监控" })).toHaveCount(0)
  await expect(page.locator("#root")).toHaveAttribute("inert", "")
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press("Tab")
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
  await expect(page.getByRole("searchbox")).toHaveValue("Tokyo")
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden")
})

test("charts are loaded on demand and full monitoring navigation works", async ({ page }) => {
  const requests: string[] = []
  const errors: string[] = []
  page.on("request", (req) => requests.push(req.url()))
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto("/")
  await expect(page.getByRole("button", { name: "查看 Tokyo 详情", exact: true })).toBeVisible()
  // The previous startup preloader ran at 1.2 seconds; guard against its return.
  await page.waitForTimeout(1500)
  expect(requests.some((url) => url.includes("NodeDetail") || url.includes("recharts"))).toBe(false)
  await page.getByRole("button", { name: "查看 Tokyo 详情", exact: true }).click()
  await page.getByRole("link", { name: "查看资源图表" }).click()
  await expect(page).toHaveURL(/\/node\/1$/)
  await expect(page.locator(".monitor-chart-card")).toHaveCount(5)
  await expect(page.getByRole("region", { name: "三网延迟图表" })).toBeVisible()
  await expect.poll(() => requests.some((url) => url.includes("series=ping") && new URL(url).searchParams.get("hours") === "6")).toBe(true)
  await page.getByRole("button", { name: "1 小时", exact: true }).click()
  await expect.poll(() => requests.some((url) => url.includes("series=ping") && new URL(url).searchParams.get("hours") === "1")).toBe(true)
  await page.getByRole("button", { name: "6 小时", exact: true }).click()
  await expect(page.getByRole("button", { name: "6 小时", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator(".monitor-chart-card .recharts-surface").first()).toBeVisible()
  await page.getByRole("button", { name: "24 小时", exact: true }).click()
  await expect.poll(() => requests.some((url) => url.includes("series=ping") && new URL(url).searchParams.get("hours") === "24")).toBe(true)
  await page.getByRole("button", { name: "7 天", exact: true }).click()
  await expect.poll(() => requests.some((url) => url.includes("series=ping") && new URL(url).searchParams.get("hours") === "168")).toBe(true)
  await page.getByRole("button", { name: "6 小时", exact: true }).click()
  await page.locator(".node-picker").getByRole("link", { name: /Singapore/ }).click()
  await expect(page).toHaveURL(/\/node\/2$/)
  await expect(page.getByRole("button", { name: "6 小时", exact: true })).toHaveAttribute("aria-pressed", "true")
  expect(requests.filter((url) => url.includes("/metrics?")).every((url) => Number(new URL(url).searchParams.get("points")) <= 1200)).toBe(true)
  expect(errors).toEqual([])
})

test("hub 1.3.1 peak rates appear in the existing network chart", async ({ page }) => {
  await page.goto("/node/1")
  const network = page.locator(".monitor-chart-card").filter({ hasText: "网络速率" })
  await expect(network.getByText("虚线峰值")).toBeVisible()
  await expect(network.locator(".recharts-line-curve")).toHaveCount(4)
})

test("older hub history keeps the original two network lines", async ({ page }) => {
  await page.route(/\/api\/nodes\/1\/metrics\?.*series=metrics/, (route) => {
    const data = history(1, 6, "metrics")
    data.metrics.forEach((point) => {
      Reflect.deleteProperty(point, "net_rx_max")
      Reflect.deleteProperty(point, "net_tx_max")
    })
    return route.fulfill({ json: data })
  })
  await page.goto("/node/1")
  const network = page.locator(".monitor-chart-card").filter({ hasText: "网络速率" })
  await expect(network.getByText("虚线峰值")).toHaveCount(0)
  await expect(network.locator(".recharts-line-curve")).toHaveCount(2)
})

test("live OS changes update the monitoring header", async ({ page }) => {
  let os = "Debian 13"
  await page.route("**/api/nodes", (route) => route.fulfill({ json: { nodes: nodes.map((node) => node.id === 1 ? { ...node, os } : node) } }))
  await page.goto("/node/1")
  await expect(page.locator(".monitor-head-os")).toContainText("Debian 13")
  os = "Ubuntu 24.04"
  await expect(page.locator(".monitor-head-os")).toContainText("Ubuntu 24.04", { timeout: 15000 })
})

test("offline and high-usage nodes are actionable without invented live zeroes", async ({ page }) => {
  const snapshot = structuredClone(nodes)
  snapshot[0].online = false
  snapshot[0].last_seen = 1
  snapshot[0].last_seen_ago = 7200
  snapshot[1].metrics.cpu = 96
  await page.route("**/api/nodes", (route) => route.fulfill({ json: { nodes: snapshot } }))
  await page.routeWebSocket("**/api/ws", (socket) => socket.send(JSON.stringify({ nodes: snapshot })))
  await page.goto("/")
  await expect(page.locator(".server-summary-card")).toContainText("5 / 6")
  await page.getByRole("button", { name: "离线 1", exact: true }).click()
  const offline = page.getByRole("button", { name: "查看 Tokyo 详情", exact: true })
  await expect(offline.locator(".status-dot")).toHaveAttribute("data-status", "offline")
  await expect(offline.locator(".status-dot-pulse")).toHaveCount(1)
  expect(await offline.locator(".status-dot-pulse").evaluate((el) => getComputedStyle(el).animationName)).toBe("once-status-pulse")
  await expect(offline.locator(".compact-card-speed")).toHaveText("—")
  await offline.click()
  await expect(page.getByRole("dialog")).toContainText("2 小时")
  await page.getByRole("button", { name: "关闭详情", exact: true }).click()
  await page.getByRole("button", { name: "异常 2", exact: true }).click()
  await expect(page.getByRole("button", { name: /^查看 .+ 详情$/ })).toHaveCount(2)
  await expect(page.getByRole("button", { name: "查看 Singapore 详情" }).locator(".compact-card-meter").first()).toHaveAttribute("data-level", "danger")
})

test("monitor indicators and location align with the home cards", async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/")
    const homeDot = await page.locator(".compact-card-dot").first().evaluate((el) => el.getBoundingClientRect().width)
    const summaryBorder = await page.locator(".summary-metrics").evaluate((el) => getComputedStyle(el).borderTopWidth)
    expect(summaryBorder).toBe("0px")
    await page.getByRole("button", { name: "查看 Tokyo 详情", exact: true }).click()
    expect(await page.locator(".detail-groups").evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("0px")
    await page.getByRole("button", { name: "关闭详情", exact: true }).click()
    await page.goto("/node/1")
    const header = page.locator(".monitor-node-head")
    await expect(header).toContainText("Tokyo")
    const monitorDot = await header.locator(".monitor-status-dot").evaluate((el) => el.getBoundingClientRect().width)
    expect(monitorDot).toBe(homeDot)
    const location = await header.locator(".monitor-head-location").evaluate((el) => el.getBoundingClientRect().right)
    const right = await header.evaluate((el) => el.getBoundingClientRect().right)
    expect(right - location).toBeLessThan(25)
    const pickerLink = page.locator(".monitor-node-link").first()
    const flagRight = await pickerLink.locator(":scope > span:last-child").evaluate((el) => el.getBoundingClientRect().right)
    const linkRight = await pickerLink.evaluate((el) => el.getBoundingClientRect().right)
    expect(linkRight - flagRight).toBeLessThan(25)
    if (width === 1440) await expect(header.locator(".monitor-head-os")).toContainText("Debian 13")
  }
})

test("region, system and speed headings align with card data at phone and desktop widths", async ({ page }) => {
  for (const width of [320, 375, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/")
    const header = page.locator(".compact-card-head")
    const row = page.getByRole("button", { name: "查看 Tokyo 详情", exact: true })
    await expect(header).toContainText("地区")
    await expect(header).toContainText("系统")
    expect(await header.evaluate((el) => el.children.length)).toBe(9)
    expect(await row.evaluate((el) => el.children.length)).toBe(9)
    const positions = await Promise.all([
      header.evaluate((el) => Array.from(el.children, (item) => ({ x: item.getBoundingClientRect().left, width: item.getBoundingClientRect().width }))),
      row.evaluate((el) => Array.from(el.children, (item) => ({ x: item.getBoundingClientRect().left, width: item.getBoundingClientRect().width }))),
    ])
    positions[0].forEach((heading, index) => {
      if (index === 0 || heading.width === 0) return
      expect(Math.abs(heading.x - positions[1][index].x)).toBeLessThan(1)
      expect(Math.abs(heading.width - positions[1][index].width)).toBeLessThan(1)
    })
    await expect(row.locator(".compact-card-region img")).toBeVisible()
    if (width >= 768) await expect(row.locator(".compact-card-region")).toContainText("JP")
    if (width >= 1000) await expect(row.locator(".compact-card-os")).toContainText("Debian 13")
    if (width === 1440) {
      const centered = await header.evaluate((el) => [3, 5, 6, 7, 8].map((index) => {
        const child = el.children[index]
        const style = getComputedStyle(child)
        return style.display === "flex" ? style.justifyContent : style.textAlign
      }))
      expect(centered).toEqual(["center", "center", "center", "center", "center"])
      const systemCenters = await page.evaluate(() => {
        const head = document.querySelector(".compact-card-system-head")!
        const os = document.querySelector(".compact-card-os")!
        const children = Array.from(os.children)
        const headRect = head.getBoundingClientRect()
        return [(headRect.left + headRect.right) / 2, (children[0].getBoundingClientRect().left + children.at(-1)!.getBoundingClientRect().right) / 2]
      })
      expect(Math.abs(systemCenters[0] - systemCenters[1])).toBeLessThan(2)
      expect(await header.evaluate((el) => parseFloat(getComputedStyle(el.children[1]).paddingLeft))).toBeGreaterThan(0)
      await row.click()
      const dialog = page.getByRole("dialog", { name: "Tokyo 详情" })
      await expect(dialog.locator(".detail-head-location")).toContainText("Debian 13")
      expect(await dialog.locator(".detail-groups").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length)).toBe(1)
    }
  }
})

test("phone cards balance metric widths and show the maximum traffic value", async ({ page }) => {
  for (const width of [320, 351, 374, 375, 390, 430, 431]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/")
    const row = page.getByRole("button", { name: "查看 Tokyo 详情", exact: true })
    const position = await row.evaluate((el) => {
      const flag = el.querySelector(".compact-card-region")!.getBoundingClientRect()
      return flag.left - el.getBoundingClientRect().left
    })
    expect(position).toBeLessThan(width < 375 ? 145 : 135)
    const speedFits = await row.locator(".compact-card-speed").evaluate((el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      return range.getBoundingClientRect().width <= el.clientWidth
    })
    expect(speedFits).toBe(true)
    const meters = row.locator(".compact-card-meter")
    const widths = await meters.evaluateAll((items) => items.map((item) => item.getBoundingClientRect().width))
    if (width === 390) {
      expect(widths.slice(0, 3).every((metric) => metric >= 33)).toBe(true)
      expect(widths[3]).toBeLessThanOrEqual(80)
    }
    const textFits = await meters.last().evaluate((el) => {
      const label = el.querySelector<HTMLElement>(".compact-card-meter-label")!
      label.textContent = "1000G / 1000G"
      const range = document.createRange()
      range.selectNodeContents(label)
      return range.getBoundingClientRect().width <= el.clientWidth - 2
    })
    expect(textFits).toBe(true)
  }
})

test("high-DPI mobile text sizing cannot enlarge metrics past their grid columns", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  await page.goto("/")
  const layout = await page.evaluate(() => ({
    viewport: innerWidth,
    page: document.documentElement.scrollWidth,
    adjust: getComputedStyle(document.documentElement).webkitTextSizeAdjust,
    rows: Array.from(document.querySelectorAll(".server-node-list > .server-card .compact-card-hit")).map((row) => ({
      right: row.getBoundingClientRect().right,
      meters: Array.from(row.querySelectorAll<HTMLElement>(".compact-card-meter"), (meter) => {
        const range = document.createRange()
        range.selectNodeContents(meter)
        return { width: meter.clientWidth, textWidth: range.getBoundingClientRect().width, fontSize: getComputedStyle(meter).fontSize }
      }),
    })),
  }))
  expect(layout.page).toBe(layout.viewport)
  expect(layout.adjust).toBe("100%")
  for (const row of layout.rows) {
    expect(row.right).toBeLessThanOrEqual(layout.viewport)
    expect(row.meters.every((meter) => Number.parseFloat(meter.fontSize) <= 10 && meter.textWidth <= meter.width)).toBe(true)
  }
  await context.close()
})

test("phone card columns stay inside the card when a scrollbar reserves width", async ({ page }) => {
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/")
    await page.addStyleTag({ content: "html { scrollbar-gutter: stable; }" })
    const card = page.locator(".server-node-list > .server-card").first()
    const gap = await card.evaluate((el) => el.getBoundingClientRect().right - el.querySelector(".compact-card-meter:last-child")!.getBoundingClientRect().right)
    expect(gap).toBeGreaterThanOrEqual(1)
  }
})

test("meter tracks and fills remain distinct in both themes", async ({ page }) => {
  await page.goto("/")
  for (const theme of ["light", "dark"]) {
    if (theme === "dark") await page.getByRole("button", { name: "切换主题" }).click()
    const fill = page.locator(".compact-card-meter").first()
    const expected = theme === "light" ? "rgb(48, 47, 51)" : "rgb(255, 254, 238)"
    await expect.poll(() => fill.evaluate((el) => getComputedStyle(el, "::before").backgroundImage)).toContain(expected)
    expect(await fill.evaluate((el) => getComputedStyle(el, "::before").backgroundImage)).toContain("rgba(0, 0, 0, 0)")
  }
})

test("resource charts use rounded curves for every range and surfaces share the detail radius", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto("/")
  const cardRadius = await page.locator(".server-summary-card").evaluate((el) => getComputedStyle(el).borderRadius)
  await page.getByRole("button", { name: "查看 Tokyo 详情" }).click()
  expect(await page.locator(".system-detail-card").evaluate((el) => getComputedStyle(el).borderRadius)).toBe(cardRadius)
  await page.getByRole("button", { name: "关闭详情" }).click()
  await page.goto("/node/1")
  for (const label of ["1 小时", "6 小时", "24 小时", "7 天"]) {
    await page.getByRole("button", { name: label, exact: true }).click()
    await expect(page.locator(".monitor-chart-card .recharts-surface").first()).toBeVisible()
    const curves = page.locator(".monitor-chart-card:not(.monitor-latency-card) .recharts-area-curve, .monitor-chart-card:not(.monitor-latency-card) .recharts-line-curve")
    await expect(curves).toHaveCount(7)
    for (const path of await curves.all()) expect(await path.getAttribute("d")).toContain("C")
  }
  for (const selector of [".monitor-overview", ".monitor-chart-card"]) {
    expect(await page.locator(selector).first().evaluate((el) => getComputedStyle(el).borderRadius)).toBe(cardRadius)
  }
})

test("monitor picker and status filters use consistent pill shapes and surfaces", async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/")
    const filterShape = await page.locator(".server-status-filters").evaluate((el) => {
      const button = el.querySelector("button")!
      return {
        groupRadius: parseFloat(getComputedStyle(el).borderRadius),
        buttonRadius: parseFloat(getComputedStyle(button).borderRadius),
        height: el.getBoundingClientRect().height,
        buttonHeight: button.getBoundingClientRect().height,
      }
    })
    expect(filterShape.groupRadius).toBeGreaterThanOrEqual(filterShape.height / 2)
    expect(filterShape.buttonRadius).toBeGreaterThanOrEqual(filterShape.buttonHeight / 2)
    await page.goto("/node/1")
    await expect(page.locator(".monitor-chart-card").first()).toBeVisible()
    const shape = await page.locator(".node-picker").evaluate((picker) => {
      const current = picker.querySelector('.monitor-node-link[aria-current="page"]')!
      const other = picker.querySelector('.monitor-node-link:not([aria-current])')!
      const card = document.querySelector(".monitor-chart-card")!
      return {
        pickerRadius: getComputedStyle(picker).borderRadius,
        cardRadius: getComputedStyle(card).borderRadius,
        currentRadius: parseFloat(getComputedStyle(current).borderRadius),
        otherRadius: parseFloat(getComputedStyle(other).borderRadius),
        currentHeight: current.getBoundingClientRect().height,
        otherHeight: other.getBoundingClientRect().height,
        currentBorder: getComputedStyle(current).borderColor,
        otherBorder: getComputedStyle(other).borderColor,
        otherBackground: getComputedStyle(other).backgroundColor,
        pickerBackground: getComputedStyle(picker).backgroundColor,
      }
    })
    expect(shape.pickerRadius).toBe(shape.cardRadius)
    expect(shape.currentRadius).toBeGreaterThanOrEqual(shape.currentHeight / 2)
    expect(shape.otherRadius).toBeGreaterThanOrEqual(shape.otherHeight / 2)
    expect(shape.otherBackground).toBe(shape.pickerBackground)
    if (width === 390) {
      // The only intended difference between the two layouts is their geometry.
      await page.setViewportSize({ width: 1440, height: 900 })
      const desktop = await page.locator(".node-picker").evaluate((picker) => {
        const current = picker.querySelector('.monitor-node-link[aria-current="page"]')!
        const other = picker.querySelector('.monitor-node-link:not([aria-current])')!
        return [getComputedStyle(current).borderColor, getComputedStyle(other).borderColor, getComputedStyle(other).backgroundColor]
      })
      expect(desktop).toEqual([shape.currentBorder, shape.otherBorder, shape.otherBackground])
    }
  }
})

test("large surfaces use the same chart card finish in both themes", async ({ page }) => {
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme })
    await page.goto("/")
    const summary = await page.locator(".server-summary-card").evaluate((el) => {
      const css = getComputedStyle(el)
      return [css.borderRadius, css.borderColor, css.backgroundColor, css.backgroundImage, css.boxShadow]
    })
    for (const selector of [".server-search input", ".server-sort-select", ".server-sort-direction", ".server-status-filters"]) {
      expect(await page.locator(selector).evaluate((el) => {
        const css = getComputedStyle(el)
        return {
          radius: parseFloat(css.borderRadius),
          height: el.getBoundingClientRect().height,
          finish: [css.borderColor, css.backgroundColor, css.backgroundImage, css.boxShadow],
        }
      })).toEqual(expect.objectContaining({ finish: summary.slice(1) }))
      const shape = await page.locator(selector).evaluate((el) => ({ radius: parseFloat(getComputedStyle(el).borderRadius), height: el.getBoundingClientRect().height, width: el.getBoundingClientRect().width }))
      expect(shape.radius).toBeGreaterThanOrEqual(shape.height / 2)
      if (selector === ".server-sort-direction") expect(shape.width).toBe(shape.height)
    }
    const rowFinish = await page.locator(".server-node-list > .server-card").first().evaluate((el) => {
      const css = getComputedStyle(el)
      return {
        radius: parseFloat(css.borderRadius),
        height: el.getBoundingClientRect().height,
        finish: [css.borderColor, css.backgroundColor, css.backgroundImage, css.boxShadow],
      }
    })
    expect(rowFinish.radius).toBeGreaterThanOrEqual(rowFinish.height / 2)
    expect(rowFinish.finish).toEqual(summary.slice(1))
    expect(await page.locator(".server-summary-card .metric-tile").first().evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0s")
    const summaryTile = page.locator(".server-summary-card .metric-tile").first()
    const tileBackground = await summaryTile.evaluate((el) => getComputedStyle(el).backgroundColor)
    await summaryTile.hover()
    expect(await summaryTile.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(tileBackground)
    await page.getByRole("button", { name: "查看 Tokyo 详情" }).click()
    for (const selector of [".system-detail-card", ".latency-float-card"]) {
      await expect(page.locator(selector)).toBeVisible()
      expect(await page.locator(selector).evaluate((el) => {
        const css = getComputedStyle(el)
        return [css.borderRadius, css.borderColor, css.backgroundColor, css.backgroundImage, css.boxShadow]
      })).toEqual(summary)
    }
    await page.getByRole("button", { name: "关闭详情" }).click()
    await page.goto("/node/1")
    await expect(page.locator(".monitor-chart-card").first()).toBeVisible()
    for (const selector of [".node-picker", ".monitor-overview", ".monitor-chart-card"]) {
      expect(await page.locator(selector).first().evaluate((el) => {
        const css = getComputedStyle(el)
        return [css.borderRadius, css.borderColor, css.backgroundColor, css.backgroundImage, css.boxShadow]
      })).toEqual(summary)
    }
    for (const selector of [".node-picker > input", ".monitor-node-link:not([aria-current])"]) {
      expect(await page.locator(selector).first().evaluate((el) => {
        const css = getComputedStyle(el)
        return [css.borderColor, css.backgroundColor, css.backgroundImage, css.boxShadow]
      })).toEqual(summary.slice(1))
    }
  }
})

test("all latency ranges can switch between smoothed and raw curves", async ({ page }) => {
  await page.goto("/node/1")
  await expect(page.locator(".monitor-node-head")).not.toContainText("agent")
  await expect(page.locator(".monitor-node-head")).not.toContainText("在线")
  for (const label of ["1 小时", "6 小时", "24 小时", "7 天"]) {
    await page.getByRole("button", { name: label, exact: true }).click()
    const smoothButton = page.getByRole("button", { name: "平滑", exact: true })
    if (await smoothButton.getAttribute("aria-pressed") === "false") await smoothButton.click()
    const line = page.locator(".monitor-latency-card .recharts-line-curve").first()
    await expect(line).toBeVisible()
    const smoothed = await line.getAttribute("d")
    await smoothButton.click()
    await expect(smoothButton).toHaveAttribute("aria-pressed", "false")
    await expect.poll(() => line.getAttribute("d")).not.toBe(smoothed)
  }
})

test("monitor time and latency tags keep one pill finish in both themes", async ({ page }) => {
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme })
    await page.goto("/")
    for (const selector of ['.once-nav-item[aria-current="page"]', '.server-filter-button[aria-pressed="true"]']) {
      expect(await page.locator(selector).evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none")
    }
    await page.goto("/node/1")
    await expect(page.locator(".monitor-chip").first()).toBeVisible()
    const card = await page.locator(".monitor-chart-card").first().evaluate((el) => {
      const css = getComputedStyle(el)
      return [css.borderColor, css.backgroundColor, css.backgroundImage, css.boxShadow]
    })
    const selectedRange = await page.locator(".monitor-range-tab[aria-pressed=true]").evaluate((el) => {
      const css = getComputedStyle(el)
      return [css.borderColor, css.backgroundColor, css.backgroundImage, css.boxShadow]
    })
    expect(selectedRange[3]).not.toBe("none")
    expect(await page.locator('.monitor-node-link[aria-current="page"]').evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none")
    for (const selector of [".monitor-range-tab[aria-pressed=false]", ".monitor-chip[aria-pressed=true]"]) {
      const tags = page.locator(selector)
      expect(await tags.count()).toBeGreaterThan(0)
      for (const tag of await tags.all()) {
        const shape = await tag.evaluate((el) => {
          const css = getComputedStyle(el)
          return { radius: parseFloat(css.borderRadius), height: el.getBoundingClientRect().height, finish: [css.borderColor, css.backgroundColor, css.backgroundImage, css.boxShadow] }
        })
        expect(shape.radius).toBeGreaterThanOrEqual(shape.height / 2)
        expect(shape.finish).toEqual(selector.startsWith(".monitor-chip") ? selectedRange : card)
      }
    }
  }
})

for (const width of [320, 375, 390, 768, 1440, 1920]) {
  test(`responsive layout, theme and drawer at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/")
    await expect(page.getByRole("button", { name: "查看 Tokyo 详情", exact: true })).toBeVisible()
    if (width <= 390) {
      const card = page.locator(".server-card").filter({ has: page.getByRole("button", { name: "查看 Tokyo 详情", exact: true }) })
      const tops = await card.locator(".compact-card-meter").evaluateAll((tiles) => tiles.map((tile) => tile.getBoundingClientRect().top))
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(2)
      expect(await card.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(65)
      expect(await card.evaluate((el) => el.querySelector(".compact-card-meter:last-child")!.getBoundingClientRect().right <= el.getBoundingClientRect().right - 1)).toBe(true)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    if (width >= 1440) {
      const shellWidth = await page.locator("main").evaluate((el) => el.getBoundingClientRect().width)
      expect(shellWidth).toBeLessThanOrEqual(1321)
      await expect(page.getByRole("button", { name: "查看 Tokyo 详情" }).locator(".compact-card-os")).toContainText("Debian 13")
    }
    const card = page.locator(".server-node-list .server-card").first()
    if (width < 768) {
      await expect(page.locator(".compact-card-head")).toBeVisible()
      const centers = await card.locator(".compact-card-name, .compact-card-region, .compact-card-speed, .compact-card-meter").evaluateAll((items) => items.map((el) => (el.getBoundingClientRect().top + el.getBoundingClientRect().bottom) / 2))
      expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(3)
    }
    const cardShape = await card.evaluate((el) => ({ radius: parseFloat(getComputedStyle(el).borderRadius), height: el.getBoundingClientRect().height }))
    const searchShape = await page.getByRole("searchbox").evaluate((el) => ({ radius: parseFloat(getComputedStyle(el).borderRadius), height: el.getBoundingClientRect().height }))
    expect(cardShape.radius).toBeGreaterThanOrEqual(cardShape.height / 2)
    expect(searchShape.radius).toBeGreaterThanOrEqual(searchShape.height / 2)
    // The summary stays in one row without the redundant all-online tag.
    const summary = page.locator(".server-summary-row")
    expect(await summary.evaluate((el) => Math.abs(el.children[0].getBoundingClientRect().top - el.children[1].getBoundingClientRect().top))).toBeLessThan(2)
    await expect(page.locator(".summary-online-tag")).toHaveCount(0)
    await page.getByRole("button", { name: "切换主题", exact: true }).click()
    await expect(page.locator("html")).toHaveClass(/dark/)
    await page.getByRole("button", { name: "查看 Tokyo 详情", exact: true }).click()
    await expect(page.getByRole("button", { name: "关闭详情", exact: true })).toBeInViewport()
    expect(await page.getByRole("dialog").evaluate((el) => el.getBoundingClientRect().width <= window.innerWidth)).toBe(true)
    await page.getByRole("button", { name: "关闭详情", exact: true }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
  })
}
