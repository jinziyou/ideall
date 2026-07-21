// 回收站端到端冒烟 (Playwright) —— 真浏览器驱动:
//   预置已删除 file/note/thread 节点 → 通过 /activity/deleted UI 恢复 → 通过 UI 清空。
//
// 用法: pnpm smoke:trash
// 可选: BASE=http://localhost:<端口> pnpm smoke:trash
// 截图: /tmp/trash-smoke/*.png
import { BASE, createSmokeRun, escapeRegex, recordNoPageErrors, sleep } from "./lib.mjs"

const TRASH_URL = `${BASE}/activity/deleted`
const SHOT_DIR = "/tmp/trash-smoke"
const RUN_ID = Date.now()
const WORKSPACE_KEY = "ideall:workspace:v1"
const PREFIX = `ideall-trash-smoke-${RUN_ID}`

const IDS = {
  note: `note_trash_${RUN_ID}`,
  fileRestore: `file_trash_restore_${RUN_ID}`,
  thread: `thread_trash_${RUN_ID}`,
  filePurge: `file_trash_purge_${RUN_ID}`,
}

const TITLES = {
  note: `${PREFIX}-note`,
  fileRestore: `${PREFIX}-restore.md`,
  thread: `${PREFIX}-thread`,
  filePurge: `${PREFIX}-purge.md`,
}

async function openTrash(page) {
  await page.goto(TRASH_URL, { waitUntil: "domcontentloaded", timeout: 30000 })
  await page.locator("h1:visible", { hasText: "回收站" }).waitFor({
    state: "visible",
    timeout: 30000,
  })
}

async function cleanupSeeded(page) {
  await page.evaluate(
    async ({ ids, prefix }) => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("wonita-home")
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(["nodes", "blobs", "trash_snapshots"], "readwrite")
          const nodes = tx.objectStore("nodes")
          const blobs = tx.objectStore("blobs")
          const snapshots = tx.objectStore("trash_snapshots")
          const allReq = nodes.getAll()
          allReq.onsuccess = () => {
            const targetIds = new Set(Object.values(ids))
            for (const node of allReq.result) {
              const own = targetIds.has(node?.id) || String(node?.title ?? "").startsWith(prefix)
              if (!own) continue
              nodes.delete(node.id)
              snapshots.delete(node.id)
              if (node?.blobRef?.key) blobs.delete(node.blobRef.key)
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
    { ids: IDS, prefix: PREFIX },
  )
}

async function seedTrash(page) {
  await page.evaluate(
    async ({ ids, titles }) => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("wonita-home")
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      try {
        const now = Date.now()
        const note = {
          id: ids.note,
          kind: "note",
          title: titles.note,
          parentId: null,
          sortKey: `trash-note-${now}`,
          tags: ["smoke"],
          createdAt: now - 4000,
          updatedAt: now - 4000,
          content: [{ type: "p", children: [{ text: "trash smoke note body" }] }],
        }
        const fileRestoreText = "trash smoke file restore body"
        const fileRestore = {
          id: ids.fileRestore,
          kind: "file",
          title: titles.fileRestore,
          parentId: null,
          sortKey: `trash-file-restore-${now}`,
          tags: ["smoke"],
          createdAt: now - 3000,
          updatedAt: now - 3000,
          blobRef: {
            store: "blobs",
            key: ids.fileRestore,
            size: fileRestoreText.length,
            mime: "text/markdown",
          },
          content: null,
        }
        const thread = {
          id: ids.thread,
          kind: "thread",
          title: titles.thread,
          parentId: null,
          sortKey: `trash-thread-${now}`,
          tags: [],
          createdAt: now - 2000,
          updatedAt: now - 2000,
          content: { messages: [{ role: "user", content: "trash smoke thread message" }] },
        }
        const filePurgeText = "trash smoke file purge body"
        const filePurge = {
          id: ids.filePurge,
          kind: "file",
          title: titles.filePurge,
          parentId: null,
          sortKey: `trash-file-purge-${now}`,
          tags: ["smoke"],
          createdAt: now - 1000,
          updatedAt: now - 1000,
          blobRef: {
            store: "blobs",
            key: ids.filePurge,
            size: filePurgeText.length,
            mime: "text/markdown",
          },
          content: null,
        }
        const deletedAt = now
        const tombstones = [
          { ...note, content: [], deletedAt, updatedAt: deletedAt },
          { ...fileRestore, deletedAt, updatedAt: deletedAt },
          { ...thread, deletedAt, updatedAt: deletedAt },
          { ...filePurge, deletedAt, updatedAt: deletedAt },
        ]
        const snapshots = [
          { id: note.id, node: note, capturedAt: now },
          {
            id: fileRestore.id,
            node: fileRestore,
            blob: new Blob([fileRestoreText], { type: "text/markdown" }),
            capturedAt: now,
          },
          { id: thread.id, node: thread, capturedAt: now },
          {
            id: filePurge.id,
            node: filePurge,
            blob: new Blob([filePurgeText], { type: "text/markdown" }),
            capturedAt: now,
          },
        ]

        await new Promise((resolve, reject) => {
          const tx = db.transaction(["nodes", "trash_snapshots"], "readwrite")
          const nodes = tx.objectStore("nodes")
          const trash = tx.objectStore("trash_snapshots")
          for (const node of tombstones) nodes.put(node)
          for (const snapshot of snapshots) trash.put(snapshot)
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
          tx.onabort = () => reject(tx.error)
        })
      } finally {
        db.close()
      }
    },
    { ids: IDS, titles: TITLES },
  )
}

async function readNode(page, id) {
  return page.evaluate(
    async (nodeId) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("wonita-home")
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction("nodes", "readonly")
          const req = tx.objectStore("nodes").get(nodeId)
          req.onsuccess = () => {
            db.close()
            resolve(req.result ?? null)
          }
          req.onerror = () => {
            db.close()
            reject(req.error)
          }
        }
      }),
    id,
  )
}

async function readBlobText(page, key) {
  return page.evaluate(
    async (blobKey) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("wonita-home")
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction("blobs", "readonly")
          const req = tx.objectStore("blobs").get(blobKey)
          req.onsuccess = async () => {
            const blob = req.result?.blob
            db.close()
            resolve(blob ? await blob.text() : null)
          }
          req.onerror = () => {
            db.close()
            reject(req.error)
          }
        }
      }),
    key,
  )
}

async function waitForLiveNode(page, id, timeout = 15000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const node = await readNode(page, id)
    if (node && node.deletedAt == null) return node
    await sleep(250)
  }
  throw new Error(`node not restored: ${id}`)
}

async function waitForMissingNode(page, id, timeout = 15000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const node = await readNode(page, id)
    if (!node) return true
    await sleep(250)
  }
  return false
}

async function restoreItem(page, id) {
  await page.getByTestId(`trash-restore-${id}`).click()
  await page.getByTestId(`trash-item-${id}`).waitFor({ state: "hidden", timeout: 15000 })
}

const run = await createSmokeRun({ shotDir: SHOT_DIR })
const { page, pageErrors, record, markStage } = run

await page.addInitScript((key) => {
  try {
    sessionStorage.removeItem(key)
    localStorage.removeItem(key)
  } catch {
    /* ignore storage reset failures */
  }
}, WORKSPACE_KEY)

try {
  console.log(`\n▶ 回收站冒烟目标: ${TRASH_URL}\n`)

  markStage("seed")
  await openTrash(page)
  await cleanupSeeded(page)
  await seedTrash(page)
  await openTrash(page)
  for (const id of Object.values(IDS)) {
    await page.getByTestId(`trash-item-${id}`).waitFor({ state: "visible", timeout: 15000 })
  }
  record("回收站展示文件、笔记与对话删除项", true)

  const trashEntry = page.locator("aside").getByRole("treeitem", {
    name: "删除",
    exact: true,
  })
  await trashEntry.waitFor({ state: "visible", timeout: 15000 })
  record("左侧活动分区高亮删除入口", (await trashEntry.getAttribute("aria-selected")) === "true")
  await page.screenshot({ path: `${SHOT_DIR}/1-seeded.png` })

  markStage("restore note")
  await restoreItem(page, IDS.note)
  const restoredNote = await waitForLiveNode(page, IDS.note)
  record(
    "回收站可恢复笔记正文快照",
    restoredNote.content?.[0]?.children?.[0]?.text === "trash smoke note body",
  )

  markStage("restore file")
  await restoreItem(page, IDS.fileRestore)
  await waitForLiveNode(page, IDS.fileRestore)
  const blobText = await readBlobText(page, IDS.fileRestore)
  record("回收站可恢复文件 Blob", blobText === "trash smoke file restore body")

  markStage("restore thread")
  await restoreItem(page, IDS.thread)
  const restoredThread = await waitForLiveNode(page, IDS.thread)
  record(
    "回收站可恢复对话线程",
    restoredThread.content?.messages?.[0]?.content === "trash smoke thread message",
  )

  markStage("purge")
  await page.getByTestId(`trash-purge-${IDS.filePurge}`).click()
  await page
    .getByRole("dialog", { name: new RegExp(`永久删除「${escapeRegex(TITLES.filePurge)}」`) })
    .getByRole("button", { name: "永久删除", exact: true })
    .click()
  await page.getByTestId(`trash-item-${IDS.filePurge}`).waitFor({ state: "hidden", timeout: 15000 })
  record("回收站可永久删除文件删除项", await waitForMissingNode(page, IDS.filePurge))
  await page.screenshot({ path: `${SHOT_DIR}/2-cleared.png` })

  recordNoPageErrors(pageErrors, record)
} catch (e) {
  record("回收站冒烟脚本异常", false, String(e.message).split("\n")[0])
  await page.screenshot({ path: `${SHOT_DIR}/error.png` }).catch(() => {})
} finally {
  try {
    await cleanupSeeded(page)
  } catch {
    /* ignore cleanup failures */
  }
  await run.close()
}

run.finish("{1-seeded,2-cleared,error}.png")
