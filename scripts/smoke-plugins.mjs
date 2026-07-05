// Plugin core smoke test (Playwright) against the real browser UI:
//   audio import -> database create/write/delete -> code diagnostics -> git fallback.
//
// Usage: pnpm smoke:plugins
// Optional: BASE=http://localhost:<port> pnpm smoke:plugins
// Screenshots: /tmp/plugins-smoke/*.png
import { BASE, createSmokeRun } from "./smoke-lib.mjs"

const SHOT_DIR = "/tmp/plugins-smoke"
const RUN_ID = Date.now()
const AUDIO_TITLE = `ideall-plugin-audio-${RUN_ID}`
const TABLE_NAME = `ideall_plugin_table_${RUN_ID}`
const SECRET_TOKEN = `code-secret-${RUN_ID}`
const WORKSPACE_KEY = "ideall:workspace:v1"
const GIT_REPOS_KEY = "ideall:git:repos"
const CODE_IMPORT_REPO = `/tmp/ideall-code-import-${RUN_ID}`

async function deleteDb(page, name) {
  await page.evaluate(
    async (dbName) =>
      new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(dbName)
        req.onsuccess = () => resolve(true)
        req.onerror = () => resolve(false)
        req.onblocked = () => resolve(false)
      }),
    name,
  )
}

async function resetWorkspace(page) {
  await page.evaluate((key) => {
    sessionStorage.removeItem(key)
    localStorage.removeItem(key)
  }, WORKSPACE_KEY)
}

async function openPluginPage(page, path) {
  await resetWorkspace(page).catch(() => {})
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 30000 })
}

const run = await createSmokeRun({ shotDir: SHOT_DIR })
const { page, pageErrors, record, markStage } = run

function significantPageErrors() {
  const connectionClosed = pageErrors.some((error) => error.includes("net::ERR_CONNECTION_CLOSED"))
  return pageErrors.filter(
    (error) =>
      !error.includes("net::ERR_CONNECTION_CLOSED") &&
      !(connectionClosed && error.includes("TypeError: Failed to fetch")),
  )
}

await page.addInitScript((key) => {
  try {
    sessionStorage.removeItem(key)
    localStorage.removeItem(key)
  } catch {
    /* ignore storage reset failures */
  }
}, WORKSPACE_KEY)

try {
  console.log(`\n▶ 插件冒烟目标: ${BASE}\n`)

  markStage("audio")
  await page.goto(`${BASE}/home`, { waitUntil: "domcontentloaded", timeout: 30000 })
  await resetWorkspace(page)
  await deleteDb(page, "ideall:audio")
  await openPluginPage(page, "/audio")
  await page.getByRole("heading", { name: "音频播放器", exact: true }).waitFor({
    state: "visible",
    timeout: 30000,
  })
  await page.locator('input[type="file"][accept="audio/*"]').setInputFiles({
    name: `${AUDIO_TITLE}.wav`,
    mimeType: "audio/wav",
    buffer: Buffer.from([0]),
  })
  await page.getByText(AUDIO_TITLE, { exact: true }).waitFor({ state: "visible", timeout: 15000 })
  record("音频插件可导入并展示本地音频", true)
  const audioDownloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "导出 JSON", exact: true }).click()
  const audioDownload = await audioDownloadPromise
  const audioExportPath = await audioDownload.path()
  if (!audioExportPath) throw new Error("audio JSON export path unavailable")
  record("音频插件可导出 JSON 备份", true)
  await openPluginPage(page, "/home")
  await deleteDb(page, "ideall:audio")
  await openPluginPage(page, "/audio")
  await page
    .locator('input[type="file"][accept="application/json,.json"]')
    .setInputFiles(audioExportPath)
  await page.getByText(AUDIO_TITLE, { exact: true }).waitFor({ state: "visible", timeout: 15000 })
  record("音频插件可从 JSON 备份恢复", true)
  await page.screenshot({ path: `${SHOT_DIR}/1-audio.png` })

  markStage("database")
  await openPluginPage(page, "/home")
  await deleteDb(page, "ideall:database")
  await openPluginPage(page, "/database")
  await page.getByRole("heading", { name: "数据库", exact: true }).waitFor({
    state: "visible",
    timeout: 30000,
  })
  await page.getByPlaceholder("table name").fill(TABLE_NAME)
  await page.getByPlaceholder("columns").fill("name, value")
  await page.getByRole("button", { name: "创建", exact: true }).click()
  await page.getByRole("button", { name: TABLE_NAME, exact: false }).waitFor({
    state: "visible",
    timeout: 15000,
  })
  await page.locator('label:has-text("name") input').fill("alpha")
  await page.locator('label:has-text("value") input').fill("42")
  await page.getByRole("button", { name: "写入", exact: true }).click()
  await page.getByText("alpha", { exact: true }).waitFor({ state: "visible", timeout: 15000 })
  await page.getByText("42", { exact: true }).waitFor({ state: "visible", timeout: 15000 })
  record("数据库插件可建表并写入行", true)
  const dbDownloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "导出全部", exact: true }).click()
  const dbDownload = await dbDownloadPromise
  const dbExportPath = await dbDownload.path()
  if (!dbExportPath) throw new Error("database JSON export path unavailable")
  record("数据库插件可导出 JSON 备份", true)
  await page.getByRole("button", { name: "删除表", exact: true }).click()
  await page.getByText("创建或选择一张表", { exact: true }).waitFor({
    state: "visible",
    timeout: 15000,
  })
  record("数据库插件可删除表并清理行", true)
  await page
    .locator('input[type="file"][accept="application/json,.json"]')
    .setInputFiles(dbExportPath)
  await page.getByRole("button", { name: TABLE_NAME, exact: false }).waitFor({
    state: "visible",
    timeout: 15000,
  })
  await page.getByText("alpha", { exact: true }).waitFor({ state: "visible", timeout: 15000 })
  record("数据库插件可从 JSON 备份恢复", true)
  await page.screenshot({ path: `${SHOT_DIR}/2-database.png` })

  markStage("code")
  await openPluginPage(page, "/code")
  await page.evaluate((secret) => localStorage.setItem("ideall-smoke-token", secret), SECRET_TOKEN)
  await page.getByRole("button", { name: "刷新", exact: true }).click()
  await page.getByText("ideall-smoke-token", { exact: true }).waitFor({
    state: "visible",
    timeout: 15000,
  })
  const codeText = (await page.locator("body").textContent()) ?? ""
  record(
    "Code 插件展示诊断且敏感存储脱敏",
    codeText.includes("已脱敏") && !codeText.includes(SECRET_TOKEN),
  )
  record(
    "Code 插件展示插件数据端口",
    codeText.includes("ideall.audio.library") &&
      codeText.includes("ideall.database.workspace") &&
      codeText.includes("ideall.git.repos") &&
      codeText.includes("ideall.agent.config") &&
      codeText.includes("ideall.sync.status"),
  )
  record(
    "Code 插件展示安全存储诊断",
    codeText.includes("安全存储") && codeText.includes("迁移/清理敏感值"),
  )
  record(
    "Code 插件展示导入入口和数据 Schema",
    codeText.includes("导入") &&
      codeText.includes("数据 Schema") &&
      codeText.includes("Git 仓库列表"),
  )
  await page
    .locator('input[type="file"][accept="application/json,.json"]')
    .last()
    .setInputFiles({
      name: `ideall-git-code-import-${RUN_ID}.json`,
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          kind: "ideall.plugin-data",
          version: 1,
          plugin: {
            id: "git",
            label: "Git",
            dataKind: "ideall.git.repos",
            dataVersion: 1,
          },
          exportedAt: new Date(RUN_ID).toISOString(),
          payload: { repos: [CODE_IMPORT_REPO] },
        }),
      ),
    })
  await page.getByText("导入会替换 Git 插件保存的仓库路径列表。", { exact: true }).waitFor({
    state: "visible",
    timeout: 15000,
  })
  await page.getByRole("button", { name: "执行导入", exact: true }).click()
  await page.getByText("导入前备份已创建", { exact: true }).waitFor({
    state: "visible",
    timeout: 15000,
  })
  const importedRepos = await page.evaluate((key) => {
    try {
      return JSON.parse(localStorage.getItem(key) || "[]")
    } catch {
      return []
    }
  }, GIT_REPOS_KEY)
  record(
    "Code 插件可预检并导入插件数据",
    Array.isArray(importedRepos) && importedRepos.includes(CODE_IMPORT_REPO),
  )
  await page.getByRole("button", { name: "恢复导入前备份", exact: true }).click()
  await page.waitForFunction((key) => localStorage.getItem(key) === "[]", GIT_REPOS_KEY)
  record("Code 插件可恢复导入前备份", true)
  await page.screenshot({ path: `${SHOT_DIR}/3-code.png` })

  markStage("git")
  await openPluginPage(page, "/git")
  await page.getByText("Git 工作台仅在桌面 App 中可用", { exact: true }).waitFor({
    state: "visible",
    timeout: 30000,
  })
  record("Git 插件在浏览器形态显示桌面 App 限定兜底", true)
  await page.screenshot({ path: `${SHOT_DIR}/4-git.png` })

  const significantErrors = significantPageErrors()
  pageErrors.splice(0, pageErrors.length, ...significantErrors)
  record(
    "运行期间无 page/console 错误",
    significantErrors.length === 0,
    significantErrors.slice(0, 4).join(" | "),
  )
} catch (e) {
  record("插件冒烟脚本异常", false, String(e.message).split("\n")[0])
  await page.screenshot({ path: `${SHOT_DIR}/error.png` }).catch(() => {})
} finally {
  try {
    await deleteDb(page, "ideall:audio")
    await deleteDb(page, "ideall:database")
    await page.evaluate(() => localStorage.removeItem("ideall-smoke-token")).catch(() => {})
    await page.evaluate((key) => localStorage.removeItem(key), GIT_REPOS_KEY).catch(() => {})
  } catch (e) {
    console.log(`cleanup skipped: ${String(e.message).split("\n")[0]}`)
  }
  await run.close()
}

run.finish("{1-audio,2-database,3-code,4-git,error}.png")
