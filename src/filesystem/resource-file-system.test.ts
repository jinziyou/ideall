import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import type { ResourceMeta } from "@protocol/resource"
import { clearVfsProvidersForTest, registerVfsProvider } from "@/vfs/registry"
import type { VfsProvider } from "@/vfs/types"
import { VfsError } from "@/vfs/types"
import {
  corePlaceRef,
  createResourceFileSystem,
  panelFileRef,
  resourceFileRef,
  resourceRefForFile,
} from "./resource-file-system"

const ctx = { actor: "ui", permissions: [], intent: "metadata" } as const

afterEach(() => clearVfsProvidersForTest())

test("resource filesystem: system panels are files under a core directory", async () => {
  const fs = createResourceFileSystem()
  const page = await fs.readDirectory(corePlaceRef("system"), ctx)
  const shell = page.entries.find((entry) => entry.target.fileId === panelFileRef("shell").fileId)
  assert.ok(shell)
  const file = await fs.stat(shell.target, ctx)
  assert.equal(file?.kind, "file")
  assert.equal(file?.mediaType, "application/vnd.ideall.shell+json")
  assert.equal(file?.properties?.tabKind, "shell")
})

test("resource filesystem: legacy resource identity and root hierarchy are preserved", async () => {
  const rootMeta: ResourceMeta = {
    ref: { scheme: "node", kind: "note", id: "root-note" },
    title: "Root",
    capabilities: ["open", "preview", "edit", "move", "delete", "read-content"],
  }
  const childMeta: ResourceMeta = {
    ref: { scheme: "node", kind: "note", id: "child-note" },
    title: "Child",
    parent: rootMeta.ref,
    capabilities: rootMeta.capabilities,
  }
  const provider: VfsProvider = {
    scheme: "node",
    async list(query) {
      return { items: query.parent ? [childMeta] : [rootMeta, childMeta] }
    },
    async get(ref) {
      const meta = ref.id === "root-note" ? rootMeta : childMeta
      return {
        meta,
        content: {
          id: ref.id,
          kind: "note",
          parentId: ref.id === "root-note" ? null : "root-note",
          sortKey: "a",
          title: meta.title,
          tags: [],
          createdAt: 1,
          updatedAt: 1,
          content: [],
        },
      }
    },
    async actions() {
      return []
    },
    async invoke() {
      return null
    },
  }
  registerVfsProvider(provider)
  const fs = createResourceFileSystem()
  const roots = await fs.readDirectory(corePlaceRef("notes"), ctx)
  const noteEntries = roots.entries.filter((entry) => entry.target.fileId.startsWith("resource:"))
  assert.equal(noteEntries.length, 1, "place root only lists top-level notes")
  assert.deepEqual(resourceRefForFile(noteEntries[0].target), rootMeta.ref)
  const rootFile = await fs.stat(resourceFileRef(rootMeta.ref), ctx)
  assert.equal(rootFile?.kind, "directory")
  assert.equal(rootFile?.mediaType, "application/vnd.ideall.note+json")
  const children = await fs.readDirectory(resourceFileRef(rootMeta.ref), ctx)
  assert.equal(children.entries.length, 1)
  assert.deepEqual(resourceRefForFile(children.entries[0].target), childMeta.ref)
})

test("resource filesystem: stat normalizes legacy not-found errors to null", async () => {
  registerVfsProvider({
    scheme: "node",
    async list() {
      return { items: [] }
    },
    async get() {
      throw new VfsError("not-found", "legacy provider detail")
    },
    async actions() {
      return []
    },
    async invoke() {
      return null
    },
  })
  const fs = createResourceFileSystem()
  const missing = await fs.stat(
    resourceFileRef({ scheme: "node", kind: "file", id: "missing" }),
    ctx,
  )
  assert.equal(missing, null)
})

test("resource filesystem: bookmark directory links share one file identity across scenes", async () => {
  const meta: ResourceMeta = {
    ref: { scheme: "node", kind: "bookmark", id: "bookmark-1" },
    title: "Example",
    capabilities: ["open", "preview", "navigate"],
  }
  registerVfsProvider({
    scheme: "node",
    async list(query) {
      return { items: query.kinds?.includes("bookmark") ? [meta] : [] }
    },
    async get() {
      return {
        meta,
        content: {
          id: "bookmark-1",
          kind: "bookmark",
          parentId: null,
          sortKey: "a",
          title: "Example",
          tags: [],
          createdAt: 1,
          updatedAt: 1,
          content: { url: "https://example.com", description: "", favicon: "" },
        },
      }
    },
    async actions() {
      return []
    },
    async invoke() {
      return null
    },
  })
  const fs = createResourceFileSystem()
  const [bookmarks, browser] = await Promise.all([
    fs.readDirectory(corePlaceRef("bookmarks"), ctx),
    fs.readDirectory(corePlaceRef("browser"), ctx),
  ])
  const bookmarksTarget = bookmarks.entries.find((entry) =>
    entry.target.fileId.startsWith("resource:"),
  )
  const browserTarget = browser.entries.find((entry) => entry.target.fileId.startsWith("resource:"))
  assert.deepEqual(browserTarget?.target, bookmarksTarget?.target)
  assert.equal(browserTarget?.properties?.preferredEngine, "ideall.browser")
})
