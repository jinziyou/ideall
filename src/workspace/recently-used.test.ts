import assert from "node:assert/strict"
import { test } from "node:test"
import { fileRefKey, type IdeallFile } from "@protocol/file-system"
import {
  RECENTLY_USED_ENABLED_KEY,
  RECENTLY_USED_LIMIT,
  RECENTLY_USED_PAUSED_KEY,
  RECENTLY_USED_STORAGE_KEY,
  clearRecentlyUsed,
  isRecentlyUsedEnabled,
  isRecentlyUsedPaused,
  listRecentlyUsed,
  recordFileOpen,
  removeRecentlyUsedEntry,
  setRecentlyUsedEnabled,
  setRecentlyUsedEntryPrivate,
  setRecentlyUsedPaused,
  subscribeRecentlyUsed,
} from "./recently-used"

const mem = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => (mem.has(key) ? mem.get(key)! : null),
  setItem: (key: string, value: string) => void mem.set(key, value),
  removeItem: (key: string) => void mem.delete(key),
  clear: () => mem.clear(),
  key: (index: number) => [...mem.keys()][index] ?? null,
  get length() {
    return mem.size
  },
} as Storage

function file(name: string, kind: IdeallFile["kind"] = "file"): IdeallFile {
  return {
    ref: { fileSystemId: "ideall.core", fileId: `node:file:${name}` },
    kind,
    name,
    mediaType: "text/markdown",
    capabilities: ["read"],
    source: { kind: "local", id: "test" },
  }
}

function reset(): void {
  mem.clear()
  clearRecentlyUsed()
}

test("recently-used: 默认关闭——不显式启用一条都不记录", () => {
  reset()
  assert.equal(isRecentlyUsedEnabled(), false)
  recordFileOpen(file("a"), "ideall.note")
  assert.deepEqual(listRecentlyUsed(), [])
  // 关闭状态下不写入任何新条目（reset 的空文档保持原样）。
  assert.deepEqual(JSON.parse(mem.get(RECENTLY_USED_STORAGE_KEY)!).entries, [])
})

test("recently-used: 启用后记录打开,去重置顶并保留私密标记", () => {
  reset()
  setRecentlyUsedEnabled(true)
  assert.equal(isRecentlyUsedEnabled(), true)

  recordFileOpen(file("a"), "ideall.note", 1000)
  recordFileOpen(file("b"), "ideall.code", 2000)
  const keyA = fileRefKey(file("a").ref)
  setRecentlyUsedEntryPrivate(keyA, true)

  // 重新打开 a：提升到最前,private 标记保留。
  recordFileOpen(file("a"), "ideall.code", 3000)
  const entries = listRecentlyUsed()
  assert.equal(entries.length, 2)
  assert.equal(entries[0]?.refKey, keyA)
  assert.equal(entries[0]?.engineId, "ideall.code")
  assert.equal(entries[0]?.openedAt, 3000)
  assert.equal(entries[0]?.private, true)

  // 目录不记录。
  recordFileOpen(file("dir", "directory"), "ideall.directory", 4000)
  assert.equal(listRecentlyUsed().length, 2)
})

test("recently-used: 隐身暂停停止记录,既有条目保留", () => {
  reset()
  setRecentlyUsedEnabled(true)
  recordFileOpen(file("a"), "ideall.note", 1000)
  setRecentlyUsedPaused(true)
  assert.equal(isRecentlyUsedPaused(), true)

  recordFileOpen(file("b"), "ideall.code", 2000)
  assert.equal(listRecentlyUsed().length, 1)

  setRecentlyUsedPaused(false)
  recordFileOpen(file("b"), "ideall.code", 2000)
  assert.equal(listRecentlyUsed().length, 2)
})

test("recently-used: 逐条移除与清空", () => {
  reset()
  setRecentlyUsedEnabled(true)
  recordFileOpen(file("a"), "ideall.note", 1000)
  recordFileOpen(file("b"), "ideall.code", 2000)

  removeRecentlyUsedEntry(fileRefKey(file("a").ref))
  assert.equal(listRecentlyUsed().length, 1)
  assert.equal(listRecentlyUsed()[0]?.name, "b")

  clearRecentlyUsed()
  assert.deepEqual(listRecentlyUsed(), [])
})

test("recently-used: 数量封顶且最旧条目被淘汰", () => {
  reset()
  setRecentlyUsedEnabled(true)
  for (let index = 0; index < RECENTLY_USED_LIMIT + 5; index += 1) {
    recordFileOpen(file(`f-${index}`), "ideall.code", index + 1)
  }
  const entries = listRecentlyUsed()
  assert.equal(entries.length, RECENTLY_USED_LIMIT)
  assert.equal(entries[0]?.name, `f-${RECENTLY_USED_LIMIT + 4}`)
  assert.equal(entries.at(-1)?.name, "f-5")
})

test("recently-used: 损坏与超形数据按空处理,跨键 storage 事件触发订阅", () => {
  reset()
  mem.set(RECENTLY_USED_STORAGE_KEY, "{bad json")
  assert.deepEqual(listRecentlyUsed(), [])
  mem.set(
    RECENTLY_USED_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      entries: [
        { refKey: "a:b", name: "ok", mediaType: "text/plain", engineId: "e", openedAt: 1 },
        { refKey: "", name: 42, openedAt: -1 },
      ],
    }),
  )
  const entries = listRecentlyUsed()
  assert.equal(entries.length, 1)
  assert.equal(entries[0]?.name, "ok")

  // 订阅：相关键变化触发通知（node 无 window，用最小桩模拟 storage 事件）。
  const windowListeners = new Map<string, Set<(event: { key: string | null }) => void>>()
  ;(globalThis as Record<string, unknown>).window = {
    addEventListener: (type: string, fn: (event: { key: string | null }) => void) => {
      const set = windowListeners.get(type) ?? new Set()
      set.add(fn)
      windowListeners.set(type, set)
    },
    removeEventListener: (type: string, fn: (event: { key: string | null }) => void) => {
      windowListeners.get(type)?.delete(fn)
    },
  }
  try {
    let notifications = 0
    const dispose = subscribeRecentlyUsed(() => (notifications += 1))
    for (const listener of windowListeners.get("storage") ?? []) {
      listener({ key: RECENTLY_USED_ENABLED_KEY })
    }
    for (const listener of windowListeners.get("storage") ?? []) {
      listener({ key: "unrelated" })
    }
    assert.equal(notifications, 1)
    dispose()
  } finally {
    delete (globalThis as Record<string, unknown>).window
  }
})
