// 资源 / 文件 IDE 端到端冒烟 (Playwright) —— 真浏览器驱动:
//   上传 → 侧栏打开文件标签 → 编辑/保存 → 预览 → 重命名 → 标签 → 删除/撤销 → UI 清理。
//
// 用法: pnpm smoke:files
// 可选: BASE=http://localhost:<端口> pnpm smoke:files
// 截图: /tmp/files-smoke/*.png
import {
  BASE,
  SMOKE_LEVEL,
  cleanupTestFiles,
  createSilentWavBuffer,
  createSmokeRun,
  escapeRegex,
  recordNoPageErrors,
  waitForLiveFileById,
  waitForLiveFileByName,
  waitForNoLiveFileByName,
} from "./lib.mjs"

const RESOURCES_URL = `${BASE}/home/resources`
const SHOT_DIR = "/tmp/files-smoke"
const RUN_ID = Date.now()
const FILE_NAME = `ideall-file-smoke-${RUN_ID}.md`
const RENAMED_NAME = `ideall-file-smoke-${RUN_ID}-renamed.md`
const INITIAL_TEXT = "# Smoke file\n\nCreated by ideall files smoke.\n"
const FAST_SAVE_TOKEN = `fast-save-${RUN_ID}`
const EDITED_TEXT = `# Smoke file\n\nEdited by files smoke.\n\n- persisted: yes\n\n${FAST_SAVE_TOKEN}\n`
const TAGS_TEXT = "smoke, e2e"
const TEXT_PREVIEW_LIMIT = 512 * 1024
const WORKSPACE_KEY = "ideall:workspace:v1"

function createSmokePdfBuffer() {
  const stream = "BT /F1 24 Tf 48 120 Td (Smoke PDF) Tj ET"
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 180] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]
  let body = "%PDF-1.4\n"
  const offsets = []
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(body)
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")
  body += `\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(body)
}

const PREVIEW_SAMPLES = [
  {
    label: "JSON",
    name: `ideall-preview-${RUN_ID}.json`,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ name: "Preview JSON", count: 2 })),
    assert: async (dialog) => {
      await dialog.getByText("Preview JSON", { exact: false }).waitFor({ state: "visible" })
    },
  },
  {
    label: "CSV",
    name: `ideall-preview-${RUN_ID}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from("name,score\nalpha,42\n"),
    assert: async (dialog) => {
      await dialog.getByText("score", { exact: true }).waitFor({ state: "visible" })
      await dialog.getByText("alpha", { exact: true }).waitFor({ state: "visible" })
    },
  },
  {
    label: "SVG 图片",
    name: `ideall-preview-${RUN_ID}.svg`,
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="64"><rect width="120" height="64" fill="#0ea5e9"/><text x="12" y="38" font-size="18" fill="white">SVG</text></svg>',
    ),
    assert: async (dialog) => {
      await dialog.getByRole("img", { name: `ideall-preview-${RUN_ID}.svg` }).waitFor({
        state: "visible",
      })
    },
  },
  {
    label: "PDF",
    name: `ideall-preview-${RUN_ID}.pdf`,
    mimeType: "application/pdf",
    buffer: createSmokePdfBuffer(),
    assert: async (dialog) => {
      await dialog.locator(`iframe[title="ideall-preview-${RUN_ID}.pdf"]`).waitFor({
        state: "visible",
      })
    },
  },
  {
    label: "音频",
    name: `ideall-preview-${RUN_ID}.wav`,
    mimeType: "audio/wav",
    buffer: createSilentWavBuffer(),
    assert: async (dialog) => {
      await dialog.locator("audio[controls]").waitFor({ state: "visible" })
    },
  },
  {
    label: "视频",
    name: `ideall-preview-${RUN_ID}.mp4`,
    mimeType: "video/mp4",
    buffer: Buffer.from([0]),
    assert: async (dialog) => {
      await dialog.locator("video[controls]").waitFor({ state: "visible" })
    },
  },
  {
    label: "二进制兜底",
    name: `ideall-preview-${RUN_ID}.bin`,
    mimeType: "application/octet-stream",
    buffer: Buffer.from([0, 1, 2, 3]),
    assert: async (dialog) => {
      await dialog
        .getByText("该类型不能在浏览器内可靠预览", { exact: false })
        .waitFor({ state: "visible" })
    },
  },
  {
    label: "大文本截断",
    name: `ideall-preview-${RUN_ID}-large.txt`,
    mimeType: "text/plain",
    buffer: Buffer.from("A".repeat(TEXT_PREVIEW_LIMIT + 2048)),
    assert: async (dialog) => {
      await dialog.getByText("仅预览前", { exact: false }).waitFor({ state: "visible" })
    },
  },
]

async function openToolbarFileMenu(page) {
  const button = page.getByRole("button", { name: "文件操作", exact: true })
  await button.waitFor({ state: "visible", timeout: 15000 })
  await button.click()
  await page.getByRole("menu").waitFor({ state: "visible", timeout: 10000 })
}

async function uploadPreviewSamples(page) {
  await page
    .evaluate((key) => {
      sessionStorage.removeItem(key)
      localStorage.removeItem(key)
    }, WORKSPACE_KEY)
    .catch(() => {})
  await page.goto(RESOURCES_URL, { waitUntil: "domcontentloaded", timeout: 30000 })
  await page.getByRole("button", { name: /上传文件/ }).waitFor({ state: "visible", timeout: 30000 })
  await page.locator('input[type="file"]').setInputFiles(
    PREVIEW_SAMPLES.map((sample) => ({
      name: sample.name,
      mimeType: sample.mimeType,
      buffer: sample.buffer,
    })),
  )
  for (const sample of PREVIEW_SAMPLES) {
    await waitForLiveFileByName(page, sample.name)
  }
}

async function openResourcePreview(page, sample) {
  await page.goto(RESOURCES_URL, { waitUntil: "domcontentloaded", timeout: 30000 })
  await page.getByRole("button", { name: /上传文件/ }).waitFor({ state: "visible", timeout: 30000 })
  await page.getByPlaceholder("搜索文件名 / 标签").fill(sample.name)
  await page.getByText(sample.name, { exact: true }).first().waitFor({
    state: "visible",
    timeout: 15000,
  })
  await page.getByRole("button", { name: "操作", exact: true }).first().click()
  await page.getByRole("menuitem", { name: "预览", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: sample.name, exact: true })
  await dialog.waitFor({ state: "visible", timeout: 15000 })
  await sample.assert(dialog)
  await page.keyboard.press("Escape")
  await dialog.waitFor({ state: "hidden", timeout: 10000 })
}

const run = await createSmokeRun({ shotDir: SHOT_DIR })
const { page, pageErrors, record, markStage } = run

let uploadedId = null
let currentName = FILE_NAME
const cleanupNames = [FILE_NAME, RENAMED_NAME, ...PREVIEW_SAMPLES.map((sample) => sample.name)]

try {
  console.log(`\n▶ 冒烟目标: ${RESOURCES_URL} (level=${SMOKE_LEVEL})\n`)

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
  // 活动栏“文件”已经是隐藏总根的直接子树；二级文件树直接展示其子项，
  // 不再额外套旧版“资源”分组目录。
  const uploadedTreeItem = page.getByRole("treeitem", { name: new RegExp(escapeRegex(FILE_NAME)) })
  await uploadedTreeItem.waitFor({ state: "visible", timeout: 15000 })
  record("侧栏文件树展示新文件", true)

  await uploadedTreeItem.click()
  const editor = page.locator(".cm-content").first()
  await editor.waitFor({ state: "visible", timeout: 30000 })
  await page
    .getByText("Created by ideall files smoke.", { exact: true })
    .waitFor({ state: "visible", timeout: 15000 })
  record("从侧栏打开文件标签", true)

  markStage("edit and save")
  await editor.click()
  await page.keyboard.press("Control+A")
  await page.keyboard.type(EDITED_TEXT)
  await page.getByRole("button", { name: "保存", exact: true }).click({ timeout: 15000 })
  await page
    .getByText("已保存", { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 15000 })
  record("编辑 CodeMirror 内容并保存", true)
  await page.screenshot({ path: `${SHOT_DIR}/2-edited.png` })

  markStage("reload saved content")
  // 默认开发引擎直接在主标签中编辑；预览是另一个引擎，手动选择时由桌面壳打开独立窗口。
  // 此处刷新当前 FileRef + engine 标签，验证 write-blob 真正持久化，而非只检查成功 toast。
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 })
  await page.locator(".cm-content").first().waitFor({ state: "visible", timeout: 30000 })
  await page
    .getByText("Edited by files smoke.", { exact: true })
    .waitFor({ state: "visible", timeout: 15000 })
  await page
    .getByText(FAST_SAVE_TOKEN, { exact: false })
    .waitFor({ state: "visible", timeout: 15000 })
  record("刷新后开发引擎回显保存内容", true)
  record("快速输入后立即保存保留尾部 token", true)

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

  markStage("missing file preview")
  const missingFileId = `f_missing_${RUN_ID}`
  const missingNodeQuery = `file:${missingFileId}`
  const missingTabId = `node:id=${missingFileId}&kind=file`
  await page.evaluate(
    ({ nodeQuery, tabId, fileId, key }) => {
      const snapshot = {
        tabs: [
          {
            id: tabId,
            kind: "node",
            module: "home",
            title: fileId,
            path: `/home/notes?node=${encodeURIComponent(nodeQuery)}`,
            params: { kind: "file", id: fileId },
          },
        ],
        activeId: tabId,
        transientId: tabId,
        activeModule: "home",
        mode: "local",
        sidebarCollapsed: false,
        rightPanelOpen: false,
      }
      sessionStorage.setItem(key, JSON.stringify(snapshot))
      localStorage.setItem(key, JSON.stringify(snapshot))
    },
    { nodeQuery: missingNodeQuery, tabId: missingTabId, fileId: missingFileId, key: WORKSPACE_KEY },
  )
  await page.goto(`${BASE}/home/notes?node=${encodeURIComponent(missingNodeQuery)}`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  })
  await page
    .getByText("该文件不存在或已删除。", { exact: true })
    .waitFor({ state: "visible", timeout: 15000 })
  record("文件预览缺失项展示明确兜底", true)

  if (SMOKE_LEVEL === "full") {
    markStage("preview matrix upload")
    await uploadPreviewSamples(page)
    record("批量上传主流预览类型样例", true)

    for (const sample of PREVIEW_SAMPLES) {
      markStage(`preview ${sample.label}`)
      await openResourcePreview(page, sample)
      record(`预览类型覆盖：${sample.label}`, true)
    }

    await cleanupTestFiles(
      page,
      null,
      PREVIEW_SAMPLES.map((sample) => sample.name),
    )
    record("清理预览类型样例", true)
  } else {
    console.log("  - 跳过主流预览类型矩阵 (SMOKE_LEVEL=core)")
  }

  recordNoPageErrors(pageErrors, record, { ignoreConsoleFetchFailures: true })
} catch (e) {
  record("冒烟脚本异常", false, String(e.message).split("\n")[0])
  await page.screenshot({ path: `${SHOT_DIR}/error.png` }).catch(() => {})
} finally {
  try {
    await cleanupTestFiles(page, uploadedId, [...cleanupNames, currentName])
  } catch (e) {
    console.log(`cleanup skipped: ${String(e.message).split("\n")[0]}`)
  }
  await run.close()
}

run.finish("{1-uploaded,2-edited,3-renamed-tags,4-cleaned,error}.png")
