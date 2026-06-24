// agent-tools executeTool 安全/消毒边界回归网 (node:test + tsx)。
// executeTool 是 BYO-key 模型驱动写本机数据的唯一收口; 这里锁死它的写入消毒不变量:
//   - add_bookmark 拒非 http(s) 伪协议 URL (与 safeHref 闸联动, 防 javascript: 入库后被点击触发存储型 XSS);
//   - 文本截断到 STR_CAP=2000、标签截断到 24 个 / 每个 64 字符;
//   - 不存在 id 的 delete/update 返 ok:false 且**不调**底层删除。
// 经 registerHubData 注入内存端口 (不碰 IndexedDB); 任一闸回归即此处变红。
import { test } from "node:test"
import assert from "node:assert/strict"

import {
  registerHubData,
  type HubDataPort,
  type Bookmark,
  type BookmarkFolder,
  type NewBookmark,
} from "@protocol/hub-data"
import { executeTool } from "./agent-tools"

// 只实现 executeTool 书签路径会触达的方法; 其余以 notUsed 占位 (本测试不应触达)。
// 直接 `: HubDataPort` 注解使对象受编译期契约门约束 (将来端口新增方法即编译失败)。
function makeMemoryHub() {
  const bookmarks: Bookmark[] = []
  const folders: BookmarkFolder[] = []
  let seq = 0
  let deleteCalls = 0
  const notUsed = () => {
    throw new Error("executeTool 书签路径不应调用此方法")
  }
  const hub: HubDataPort = {
    async listBookmarks() {
      return bookmarks
    },
    async addBookmark(input: NewBookmark) {
      const bm: Bookmark = {
        id: `bm${++seq}`,
        title: input.title.trim() || input.url,
        url: input.url.trim(),
        description: input.description ?? "",
        favicon: input.favicon ?? "",
        folderId: input.folderId ?? null,
        tags: input.tags ?? [],
        createdAt: seq,
      }
      bookmarks.push(bm)
      return bm
    },
    async updateBookmark(id, patch) {
      const i = bookmarks.findIndex((b) => b.id === id)
      if (i >= 0) bookmarks[i] = { ...bookmarks[i], ...patch }
    },
    async deleteBookmark(id) {
      deleteCalls++
      const i = bookmarks.findIndex((b) => b.id === id)
      if (i >= 0) bookmarks.splice(i, 1)
    },
    async listFolders() {
      return folders
    },
    async addFolder(name: string) {
      const f: BookmarkFolder = { id: `f${++seq}`, name, createdAt: seq }
      folders.push(f)
      return f
    },
    listSubscriptions: notUsed,
    listAllSubscriptions: notUsed,
    addSubscription: notUsed,
    removeSubscription: notUsed,
    isSubscribed: notUsed,
    bulkPutSubscriptions: notUsed,
    listFiles: notUsed,
    updateFileMeta: notUsed,
    listNotes: notUsed,
    getNote: notUsed,
    listNoteChildren: notUsed,
    listAllNotes: notUsed,
    bulkPutNotes: notUsed,
    listThreads: notUsed,
    getThread: notUsed,
    createThread: notUsed,
    saveThread: notUsed,
    deleteThread: notUsed,
    renameThread: notUsed,
  }
  return { hub, bookmarks, deleteCalls: () => deleteCalls }
}

test("executeTool add_bookmark: 拒伪协议 URL (javascript:/data:) 且不写入", async () => {
  const mem = makeMemoryHub()
  registerHubData(mem.hub)

  for (const url of ["javascript:alert(1)", "data:text/html,<script>1</script>", "vbscript:x"]) {
    const r = await executeTool("add_bookmark", { url, title: "x" })
    assert.equal(r.ok, false, `应拒 ${url}`)
  }
  assert.equal(mem.bookmarks.length, 0, "伪协议 URL 不得入库")
})

test("executeTool add_bookmark: 合法 http(s) 写入, 并截断超长文本/海量标签", async () => {
  const mem = makeMemoryHub()
  registerHubData(mem.hub)

  const longDesc = "x".repeat(5000)
  const longTag = "t".repeat(100)
  const manyTags = Array.from({ length: 40 }, (_, i) => `tag${i}`)
  const r = await executeTool("add_bookmark", {
    url: "https://example.com/a",
    title: "标题",
    description: longDesc,
    tags: [longTag, ...manyTags],
  })
  assert.equal(r.ok, true)
  assert.equal(mem.bookmarks.length, 1)
  const bm = mem.bookmarks[0]
  assert.equal(bm.url, "https://example.com/a")
  assert.equal(bm.description.length, 2000, "description 截断到 STR_CAP=2000")
  assert.equal(bm.tags.length, 24, "标签数截断到 TAGS_CAP=24")
  assert.equal(bm.tags[0].length, 64, "单个标签截断到 TAG_LEN_CAP=64")
})

test("executeTool add_bookmark: 缺 url 返 ok:false 且不写入", async () => {
  const mem = makeMemoryHub()
  registerHubData(mem.hub)
  const r = await executeTool("add_bookmark", { title: "无 url" })
  assert.equal(r.ok, false)
  assert.equal(mem.bookmarks.length, 0)
})

test("executeTool delete_bookmark: 不存在 id 返 ok:false 且不调底层删除", async () => {
  const mem = makeMemoryHub()
  registerHubData(mem.hub)
  const r = await executeTool("delete_bookmark", { id: "不存在" })
  assert.equal(r.ok, false)
  assert.equal(mem.deleteCalls(), 0, "未命中不得调用底层 deleteBookmark")
})

test("executeTool update_bookmark: 不存在 id 返 ok:false", async () => {
  const mem = makeMemoryHub()
  registerHubData(mem.hub)
  const r = await executeTool("update_bookmark", { id: "不存在", title: "新" })
  assert.equal(r.ok, false)
})
