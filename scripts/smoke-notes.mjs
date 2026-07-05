// 笔记功能端到端冒烟 (Playwright) —— 真浏览器驱动 /home/notes:
//   新建 → 标题/正文输入 → slash「/」菜单 → 自动保存 → 刷新后持久化校验。
// 用法: pnpm smoke:notes   (或 BASE=http://localhost:<端口> pnpm smoke:notes 指向其他服)
// 前提: 先起一个服 —— 开发态 pnpm dev (5020), 或生产形态 pnpm build && pnpm serve:out (5030,
// CI 冒烟用后者, 测的就是静态导出产物)。截图落 /tmp/notes-smoke/*.png; 退出码 0=全过, 1=有失败。
import { BASE, createSmokeRun } from "./smoke-lib.mjs"

const URL = `${BASE}/home/notes`
const SHOT_DIR = "/tmp/notes-smoke"
const TITLE = "我的第一篇笔记 (冒烟)"
const BODY = "这是正文第一行 —— Plate 块编辑器。"

const run = await createSmokeRun({ shotDir: SHOT_DIR })
const { page, pageErrors, record, markStage } = run

try {
  console.log(`\n▶ 冒烟目标: ${URL}\n`)

  // 1. 加载页面并等水合完成。不用 networkidle —— dev 模式 HMR 长连接会让它永不 settle
  //    而超时 (本地与 CI 同坑); 改等「新建」钮可见 = 客户端真正水合完。
  markStage("load notes")
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 })
  const newBtn = page.getByRole("button", { name: "新建", exact: true }).first()
  await newBtn.waitFor({ state: "visible", timeout: 60000 })
  await page.screenshot({ path: `${SHOT_DIR}/1-empty.png` })
  record("页面加载并水合 (无白屏)", true)

  // 2. 新建页面 → 编辑器挂载 (首次点击会触发 dev 下 Plate 懒加载块的按需编译, 故给足超时)
  //   exact:true 关键 —— 否则「新建」会子串命中空态的「新建页面」按钮。
  markStage("new note")
  await newBtn.click({ timeout: 15000 })
  const titleInput = page.getByPlaceholder("无标题")
  await titleInput.waitFor({ state: "visible", timeout: 60000 })
  record("点「新建」→ 编辑器挂载 (标题框出现)", true)

  // 3. 输入标题
  markStage("title")
  await titleInput.fill(TITLE)
  record("输入标题", (await titleInput.inputValue()) === TITLE)

  // 4. 正文输入 (Plate contenteditable)
  markStage("body")
  const editor = page.locator('[data-slate-editor="true"]').first()
  await editor.waitFor({ state: "visible", timeout: 30000 })
  await editor.click()
  await page.keyboard.type(BODY)
  await page.waitForTimeout(300)
  record("正文键入文本", (await editor.innerText()).includes("Plate 块编辑器"))

  // 5. slash「/」菜单
  markStage("slash menu")
  await page.keyboard.press("Enter")
  await page.keyboard.type("/")
  await page.waitForTimeout(700)
  const slashVisible =
    (await page.getByText("基础块", { exact: false }).count()) > 0 ||
    (await page.getByText("代码块", { exact: false }).count()) > 0
  record("输入「/」唤出块菜单", slashVisible)
  await page.screenshot({ path: `${SHOT_DIR}/2-editor-slash.png` })
  await page.keyboard.press("Escape")

  // 6. 等自动保存落库 (去抖 600ms), 再刷新验证持久化 (同上不用 networkidle, 显式等元素回显)
  markStage("persist title")
  await page.waitForTimeout(1200)
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 })
  const titlePersisted = await page
    .getByText(TITLE, { exact: false })
    .first()
    .waitFor({ state: "visible", timeout: 30000 })
    .then(() => true)
    .catch(() => false)
  record("刷新后标题持久化 (页树可见)", titlePersisted)
  await page.screenshot({ path: `${SHOT_DIR}/3-after-reload.png` })

  // 7. 重新打开该笔记, 确认正文回显 —— 这是正文持久化的真正断言
  // (页树只显示标题、无列表摘要, 正文只能在重开的编辑器里验; 渲染异步, 轮询等文本出现)。
  markStage("reopen note")
  await page
    .getByText(TITLE, { exact: false })
    .first()
    .click({ timeout: 8000 })
    .catch(() => {})
  const editorBack = page.locator('[data-slate-editor="true"]').first()
  const reopened = await editorBack
    .waitFor({ state: "visible", timeout: 15000 })
    .then(() => true)
    .catch(() => false)
  record("重新打开笔记 → 编辑器回显", reopened)
  let bodyPersisted = false
  for (let i = 0; reopened && !bodyPersisted && i < 20; i++) {
    bodyPersisted = (await editorBack.innerText()).includes("Plate 块编辑器")
    if (!bodyPersisted) await page.waitForTimeout(250)
  }
  record("重开后正文持久化回显", bodyPersisted)
  await page.screenshot({ path: `${SHOT_DIR}/4-reopened.png` })

  record(
    "运行期间无 page/console 错误",
    pageErrors.length === 0,
    pageErrors.slice(0, 4).join(" | "),
  )
} catch (e) {
  record("冒烟脚本异常", false, String(e.message).split("\n")[0])
} finally {
  await run.close()
}

run.finish("{1-empty,2-editor-slash,3-after-reload,4-reopened}.png")
