import { chromium } from "playwright"
import { mkdir } from "node:fs/promises"

export const BASE = process.env.BASE || "http://localhost:5020"

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export async function createSmokeRun({ shotDir, viewport = { width: 1280, height: 900 } }) {
  const checks = []
  const pageErrors = []
  let stage = "init"

  const record = (name, ok, extra = "") => {
    checks.push({ name, ok, extra })
    console.log(`  ${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`)
  }

  const markStage = (name) => {
    stage = name
  }

  await mkdir(shotDir, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport })

  page.on("pageerror", (e) => pageErrors.push(`[${stage}] ${String(e.message).split("\n")[0]}`))
  page.on("console", (m) => {
    if (m.type() === "error") pageErrors.push(`[${stage}] console: ${m.text().split("\n")[0]}`)
  })

  return {
    browser,
    page,
    checks,
    pageErrors,
    record,
    markStage,
    async close() {
      await browser.close()
    },
    finish(screenshotPattern) {
      const passed = checks.filter((c) => c.ok).length
      console.log(`\n=== 结果: ${passed}/${checks.length} 通过 ===`)
      console.log(`截图: ${shotDir}/${screenshotPattern}`)
      if (pageErrors.length) {
        console.log(
          "page errors:\n" +
            pageErrors
              .slice(0, 8)
              .map((e) => "  - " + e)
              .join("\n"),
        )
      }
      process.exit(checks.every((c) => c.ok) ? 0 : 1)
    },
  }
}
