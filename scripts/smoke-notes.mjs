// 笔记功能端到端冒烟 (Playwright) —— 真浏览器驱动 /home/notes:
//   新建 → 标题/正文输入 → slash「/」菜单 → 自动保存 → 刷新后持久化校验。
// 用法: pnpm smoke:notes   (或 BASE=http://localhost:<端口> pnpm smoke:notes 指向其他端口的开发服)
// 前提: 先 pnpm dev 起开发服。截图落 /tmp/notes-smoke/*.png; 退出码 0=全过, 1=有失败。
import { chromium } from "playwright"
import { mkdir } from "node:fs/promises"

const BASE = process.env.BASE || "http://localhost:5020"
const URL = `${BASE}/home/notes`
const SHOT_DIR = "/tmp/notes-smoke"
const TITLE = "我的第一篇笔记 (冒烟)"
const BODY = "这是正文第一行 —— Plate 块编辑器。"

const checks = []
const record = (name, ok, extra = "") => {
  checks.push({ name, ok, extra })
  console.log(`  ${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`)
}

await mkdir(SHOT_DIR, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

const pageErrors = []
page.on("pageerror", (e) => pageErrors.push(String(e.message).split("\n")[0]))
page.on("console", (m) => {
  if (m.type() === "error") pageErrors.push("console: " + m.text().split("\n")[0])
})

try {
  console.log(`\n▶ 冒烟目标: ${URL}\n`)

  // 1. 加载页面 (客户端水合)
  await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 })
  await page.screenshot({ path: `${SHOT_DIR}/1-empty.png` })
  record("页面加载并水合 (无白屏)", true)

  // 2. 新建页面 → 编辑器挂载 (首次点击会触发 dev 下 Plate 懒加载块的按需编译, 故给足超时)
  //   exact:true 关键 —— 否则「新建」会子串命中空态的「新建页面」按钮。
  await page.getByRole("button", { name: "新建", exact: true }).first().click({ timeout: 15000 })
  const titleInput = page.getByPlaceholder("无标题")
  await titleInput.waitFor({ state: "visible", timeout: 60000 })
  record("点「新建」→ 编辑器挂载 (标题框出现)", true)

  // 3. 输入标题
  await titleInput.fill(TITLE)
  record("输入标题", (await titleInput.inputValue()) === TITLE)

  // 4. 正文输入 (Plate contenteditable)
  const editor = page.locator('[data-slate-editor="true"]').first()
  await editor.waitFor({ state: "visible", timeout: 30000 })
  await editor.click()
  await page.keyboard.type(BODY)
  await page.waitForTimeout(300)
  record("正文键入文本", (await editor.innerText()).includes("Plate 块编辑器"))

  // 5. slash「/」菜单
  await page.keyboard.press("Enter")
  await page.keyboard.type("/")
  await page.waitForTimeout(700)
  const slashVisible =
    (await page.getByText("基础块", { exact: false }).count()) > 0 ||
    (await page.getByText("代码块", { exact: false }).count()) > 0
  record("输入「/」唤出块菜单", slashVisible)
  await page.screenshot({ path: `${SHOT_DIR}/2-editor-slash.png` })
  await page.keyboard.press("Escape")

  // 6. 等自动保存落库 (去抖 600ms), 再刷新验证持久化
  await page.waitForTimeout(1200)
  await page.reload({ waitUntil: "networkidle", timeout: 30000 })
  await page.waitForTimeout(800)
  const titlePersisted = (await page.getByText(TITLE, { exact: false }).count()) > 0
  record("刷新后标题持久化 (列表卡片可见)", titlePersisted)
  const bodyPersisted = (await page.getByText("Plate 块编辑器", { exact: false }).count()) > 0
  record("刷新后正文摘要持久化", bodyPersisted)
  await page.screenshot({ path: `${SHOT_DIR}/3-after-reload.png` })

  // 7. 重新打开该笔记, 确认正文回显
  await page
    .getByText(TITLE, { exact: false })
    .first()
    .click({ timeout: 8000 })
    .catch(() => {})
  await page.waitForTimeout(1000)
  const reopened = (await page.locator('[data-slate-editor="true"]').count()) > 0
  record("重新打开笔记 → 编辑器回显", reopened)
  await page.screenshot({ path: `${SHOT_DIR}/4-reopened.png` })

  record(
    "运行期间无 page/console 错误",
    pageErrors.length === 0,
    pageErrors.slice(0, 4).join(" | "),
  )
} catch (e) {
  record("冒烟脚本异常", false, String(e.message).split("\n")[0])
} finally {
  await browser.close()
}

const passed = checks.filter((c) => c.ok).length
console.log(`\n=== 结果: ${passed}/${checks.length} 通过 ===`)
console.log(`截图: ${SHOT_DIR}/{1-empty,2-editor-slash,3-after-reload,4-reopened}.png`)
if (pageErrors.length)
  console.log(
    "page errors:\n" +
      pageErrors
        .slice(0, 8)
        .map((e) => "  - " + e)
        .join("\n"),
  )
process.exit(checks.every((c) => c.ok) ? 0 : 1)
