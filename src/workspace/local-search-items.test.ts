import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import type { ResourceMeta } from "@protocol/resource"
import { clearVfsProvidersForTest, registerVfsProvider } from "@/vfs/registry"
import type { VfsProvider } from "@/vfs/types"
import { loadLocalSearchItems } from "./local-search-items"

afterEach(() => {
  clearVfsProvidersForTest()
})

test("local search: builds content items from VFS resources", async () => {
  const metas: ResourceMeta[] = [
    {
      ref: { scheme: "node", kind: "note", id: "n1" },
      title: "Alpha Note",
      capabilities: ["open"],
    },
    {
      ref: { scheme: "node", kind: "feed", id: "feed:entity:alpha" },
      title: "Alpha Feed",
      capabilities: ["open"],
    },
    {
      ref: { scheme: "node", kind: "bookmark", id: "b1" },
      title: "Alpha Bookmark",
      capabilities: ["open"],
    },
    {
      ref: { scheme: "node", kind: "file", id: "f1" },
      title: "readme.md",
      iconHint: "text/markdown",
      capabilities: ["open"],
    },
    {
      ref: { scheme: "node", kind: "thread", id: "t1" },
      title: "Alpha Thread",
      capabilities: ["open"],
    },
  ]

  const provider: VfsProvider = {
    scheme: "node",
    async list(query) {
      return { items: metas.filter((meta) => meta.ref.kind === query.kind) }
    },
    async get() {
      return null
    },
    async actions() {
      return []
    },
    async invoke() {
      return null
    },
  }
  registerVfsProvider(provider)

  const items = await loadLocalSearchItems()

  assert.deepEqual(
    items.map((item) => item.group),
    ["笔记", "关注", "书签", "资源", "对话"],
  )
  assert.deepEqual(
    items.map((item) => item.target?.type),
    ["resource", "resource", "resource", "resource", "resource"],
  )
  assert.deepEqual(items.find((item) => item.group === "资源")?.fileType, {
    name: "readme.md",
    type: "text/markdown",
  })
  assert.deepEqual(items.find((item) => item.group === "书签")?.target, {
    type: "resource",
    ref: { scheme: "node", kind: "bookmark", id: "b1" },
    title: "Alpha Bookmark",
    meta: metas[2],
  })
})
