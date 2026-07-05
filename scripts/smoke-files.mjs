// File IDE smoke test (Playwright) against the real browser UI:
//   upload -> sidebar open file tab -> edit/save -> preview ->
//   rename -> tags -> delete/undo -> final UI cleanup.
//
// Usage: pnpm smoke:files
// Optional: BASE=http://localhost:<port> pnpm smoke:files
// Screenshots: /tmp/files-smoke/*.png
import { chromium } from "playwright"
import { mkdir } from "node:fs/promises"

const BASE = process.env.BASE || "http://localhost:5020"
const RESOURCES_URL = `${BASE}/home/resources`
const SHOT_DIR = "/tmp/files-smoke"
const RUN_ID = Date.now()
const FILE_NAME = `ideall-file-smoke-${RUN_ID}.md`
const RENAMED_NAME = `ideall-file-smoke-${RUN_ID}-renamed.md`
const INITIAL_TEXT = "# Smoke file\n\nCreated by ideall files smoke.\n"
const EDITED_TEXT = "# Smoke file\n\nEdited by files smoke.\n\n- persisted: yes\n"
const TAGS_TEXT = "smoke, e2e"

const checks = []
const record = (name, ok, extra = "") => {
  checks.push({ name, ok, extra })
  console.log(`  ${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

async function readLiveFileByName(page, name) {
  return page.evaluate(async (targetName) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("wonita-home")
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    try {
      const all = await new Promise((resolve, reject) => {
        const tx = db.transaction("nodes", "readonly")
        const req = tx.objectStore("nodes").getAll()
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
      return (
        all
          .filter((n) => n?.kind === "file" && n.title === targetName && n.deletedAt == null)
          .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0] ?? null
      )
    } finally {
      db.close()
    }
  }, name)
}

async function readLiveFileById(page, id) {
  return page.evaluate(async (targetId) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("wonita-home")
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("nodes", "readonly")
        const req = tx.objectStore("nodes").get(targetId)
        req.onsuccess = () => {
          const n = req.result
          resolve(n?.kind === "file" && n.deletedAt == null ? n : null)
        }
        req.onerror = () => reject(req.error)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    } finally {
      db.close()
    }
  }, id)
}

async function waitForLiveFileByName(page, name, timeout = 15000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const file = await readLiveFileByName(page, name)
    if (file) return file
    await sleep(250)
  }
  throw new Error(`file not found in IndexedDB: ${name}`)
}

async function waitForLiveFileById(page, id, timeout = 15000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const file = await readLiveFileById(page, id)
    if (file) return file
    await sleep(250)
  }
  throw new Error(`file not restored in IndexedDB: ${id}`)
}

async function waitForNoLiveFileByName(page, name, timeout = 15000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const file = await readLiveFileByName(page, name)
    if (!file) return true
    await sleep(250)
  }
  return false
}

async function cleanupTestFiles(page, id, names) {
  await page.evaluate(
    async ({ targetId, targetNames }) => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("wonita-home")
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(["nodes", "blobs"], "readwrite")
          const nodes = tx.objectStore("nodes")
          const blobs = tx.objectStore("blobs")
          const allReq = nodes.getAll()
          allReq.onsuccess = () => {
            const now = Date.now()
            for (const n of allReq.result) {
              const byId = targetId && n?.id === targetId
              const byName = targetNames.includes(n?.title)
              if (n?.kind !== "file" || n.deletedAt != null || (!byId && !byName)) continue
              nodes.put({ ...n, deletedAt: now, updatedAt: now })
              if (n.blobRef?.key) blobs.delete(n.blobRef.key)
            }
          }
          allReq.onerror = () => reject(allReq.error)
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
          tx.onabort = () => reject(tx.error)
        })
      } finally {
        db.close()
      }
    },
    { targetId: id, targetNames: names },
  )
}

async function openToolbarFileMenu(page) {
  const button = page.getByRole("button", { name: "文件操作", exact: true })
  await button.waitFor({ state: "visible", timeout: 15000 })
  await button.click()
  await page.getByRole("menu").waitFor({ state: "visible", timeout: 10000 })
}

await mkdir(SHOT_DIR, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

const pageErrors = []
let stage = "init"
const markStage = (name) => {
  stage = name
}
page.on("pageerror", (e) => pageErrors.push(`[${stage}] ${String(e.message).split("\n")[0]}`))
page.on("console", (m) => {
  if (m.type() === "error") pageErrors.push(`[${stage}] console: ${m.text().split("\n")[0]}`)
})

let uploadedId = null
let currentName = FILE_NAME

try {
  console.log(`\n▶ 冒烟目标: ${RESOURCES_URL}\n`)

  markStage("load resources")
  await page.goto(RESOURCES_URL, { waitUntil: "domcontentloaded", timeout: 30000 })
  await page.getByRole("button", { name: /上传文件/ }).waitFor({ state: "visible", timeout: 60000 })
  record("资源页加载并水合 (无白屏)", true)

  markStage("upload")
  await page.locator('input[type="file"]').setInputFiles({
    name: FILE_NAME,
    mimeType: "text/markdown",
    buffer: Buffer.from(INITIAL_TEXT),
  })
  await page.getByText(FILE_NAME, { exact: true }).first().waitFor({
    state: "visible",
    timeout: 15000,
  })
  const uploaded = await waitForLiveFileByName(page, FILE_NAME)
  uploadedId = uploaded.id
  record("上传 Markdown 文件并写入本地文件库", Boolean(uploadedId), uploadedId)
  await page.screenshot({ path: `${SHOT_DIR}/1-uploaded.png` })

  markStage("open from sidebar")
  const resourcesNode = page.getByRole("treeitem", { name: /^资源$/ }).first()
  await resourcesNode.waitFor({ state: "visible", timeout: 15000 })
  if ((await resourcesNode.getAttribute("aria-expanded")) !== "true") {
    await resourcesNode.focus()
    await page.keyboard.press("ArrowRight")
  }
  const uploadedTreeItem = page.getByRole("treeitem", { name: new RegExp(escapeRegex(FILE_NAME)) })
  await uploadedTreeItem.waitFor({ state: "visible", timeout: 15000 })
  record("侧栏资源树展示新文件", true)

  await uploadedTreeItem.click()
  await page
    .getByRole("heading", { name: FILE_NAME, exact: true })
    .waitFor({ state: "visible", timeout: 30000 })
  record("从侧栏打开文件标签", true)

  markStage("edit and save")
  await page.getByRole("button", { name: "编辑", exact: true }).click()
  const editor = page.locator(".cm-content").first()
  await editor.waitFor({ state: "visible", timeout: 30000 })
  await editor.click()
  await page.keyboard.press("Control+A")
  await page.keyboard.type(EDITED_TEXT)
  await page.getByRole("button", { name: "保存", exact: true }).click({ timeout: 15000 })
  await page.getByText("已保存", { exact: true }).waitFor({ state: "visible", timeout: 15000 })
  record("编辑 CodeMirror 内容并保存", true)
  await page.screenshot({ path: `${SHOT_DIR}/2-edited.png` })

  markStage("preview")
  await page.getByRole("button", { name: "预览", exact: true }).click()
  await page
    .getByText("Edited by files smoke.", { exact: true })
    .waitFor({ state: "visible", timeout: 15000 })
  record("预览区回显保存后的 Markdown 内容", true)

  markStage("rename")
  await openToolbarFileMenu(page)
  await page.getByRole("menuitem", { name: "重命名", exact: true }).click()
  const renameDialog = page.getByRole("dialog", { name: "重命名文件", exact: true })
  await renameDialog.getByLabel("名称", { exact: true }).fill(RENAMED_NAME)
  await renameDialog.getByRole("button", { name: "确定", exact: true }).click()
  await page
    .getByRole("heading", { name: RENAMED_NAME, exact: true })
    .waitFor({ state: "visible", timeout: 15000 })
  currentName = RENAMED_NAME
  record("文件标签内重命名并同步标题", true)

  markStage("edit tags")
  await openToolbarFileMenu(page)
  await page.getByRole("menuitem", { name: "编辑标签", exact: true }).click()
  const tagsDialog = page.getByRole("dialog", { name: "编辑标签", exact: true })
  await tagsDialog.getByLabel("标签", { exact: true }).fill(TAGS_TEXT)
  await tagsDialog.getByRole("button", { name: "保存", exact: true }).click()
  await page.getByText("#smoke", { exact: true }).waitFor({ state: "visible", timeout: 15000 })
  await page.getByText("#e2e", { exact: true }).waitFor({ state: "visible", timeout: 15000 })
  record("编辑标签并在工具栏展示", true)
  await page.screenshot({ path: `${SHOT_DIR}/3-renamed-tags.png` })

  markStage("delete undo")
  await openToolbarFileMenu(page)
  await page.getByRole("menuitem", { name: "删除", exact: true }).click()
  const deleteDialog = page.getByRole("dialog", {
    name: new RegExp(`删除「${escapeRegex(RENAMED_NAME)}」\\?`),
  })
  await deleteDialog.getByRole("button", { name: "删除", exact: true }).click()
  const undoButton = page.getByRole("button", { name: "撤销", exact: true }).last()
  await undoButton.waitFor({ state: "visible", timeout: 15000 })
  await undoButton.click()
  await waitForLiveFileById(page, uploadedId)
  record("删除后通过 toast 撤销恢复", true)

  markStage("cleanup")
  await page.goto(RESOURCES_URL, { waitUntil: "domcontentloaded", timeout: 30000 })
  await page.getByRole("button", { name: /上传文件/ }).waitFor({ state: "visible", timeout: 30000 })
  await page.getByPlaceholder("搜索文件名 / 标签").fill(RENAMED_NAME)
  await page.getByText(RENAMED_NAME, { exact: true }).first().waitFor({
    state: "visible",
    timeout: 15000,
  })
  record("撤销后资源列表可再次找到文件", true)

  await page.getByRole("button", { name: "操作", exact: true }).first().click()
  await page.getByRole("menuitem", { name: "删除", exact: true }).click()
  record("通过资源列表执行最终清理", await waitForNoLiveFileByName(page, RENAMED_NAME))
  await page.screenshot({ path: `${SHOT_DIR}/4-cleaned.png` })

  record(
    "运行期间无 page/console 错误",
    pageErrors.length === 0,
    pageErrors.slice(0, 4).join(" | "),
  )
} catch (e) {
  record("冒烟脚本异常", false, String(e.message).split("\n")[0])
  await page.screenshot({ path: `${SHOT_DIR}/error.png` }).catch(() => {})
} finally {
  try {
    await cleanupTestFiles(page, uploadedId, [FILE_NAME, RENAMED_NAME, currentName])
  } catch (e) {
    console.log(`cleanup skipped: ${String(e.message).split("\n")[0]}`)
  }
  await browser.close()
}

const passed = checks.filter((c) => c.ok).length
console.log(`\n=== 结果: ${passed}/${checks.length} 通过 ===`)
console.log(`截图: ${SHOT_DIR}/{1-uploaded,2-edited,3-renamed-tags,4-cleaned,error}.png`)
if (pageErrors.length)
  console.log(
    "page errors:\n" +
      pageErrors
        .slice(0, 8)
        .map((e) => "  - " + e)
        .join("\n"),
  )
process.exit(checks.every((c) => c.ok) ? 0 : 1)
